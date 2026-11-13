"""Build-only fixes for the pinned OpenCV 5.0.0 source tree."""
from pathlib import Path
import sys

source = Path(sys.argv[1])
bindings = source / 'modules/js/src/core_bindings.cpp'
original_bindings = bindings.read_text()
patched_bindings = original_bindings.replace(
    'using namespace cv::segmentation;  // FIXIT',
    '// Segmentation bindings are excluded from this core/imgproc-only build.')
if patched_bindings != original_bindings:
    bindings.write_text(patched_bindings)

# Scalar warp adds x*M0 + y*M1, then translation. Upstream SIMD instead adds
# y*M1 + translation first, changing float32 rounding and thousands of pixels.
# Keep vectorized sampling while matching the original scalar association.
warp = source / 'modules/imgproc/src/warp_kernels.simd.hpp'
text = warp.read_text()
start = text.index('#define CV_WARPAFFINE_VECTOR_COMPUTE_MAPPED_COORD2(')
end = text.index('#define CV_WARPPERSPECTIVE_VECTOR_COMPUTE_MAPPED_COORD2(', start)
block = text[start:end]
for coordinate, matrix, indices, row, translation in [
    ('src_x0','M0','dst_x0',1,2), ('src_y0','M3','dst_x0',4,5),
    ('src_x1','M0','dst_x1',1,2), ('src_y1','M3','dst_x1',4,5),
]:
    old = f'v_fma({matrix}, {indices}, M_{"x" if row == 1 else "y"})'
    new = f'v_add(v_add(v_mul({matrix}, {indices}), vx_setall_f32(float(y * M[{row}]))), vx_setall_f32(M[{translation}]))'
    if old not in block and new not in block:
        raise SystemExit('Pinned OpenCV affine source no longer matches the build patch')
    block = block.replace(old, new)
patched_warp = text[:start] + block + text[end:]
if patched_warp != text:
    warp.write_text(patched_warp)

# The upstream WASM v_round helper adds 0.5 and truncates (half-up). Scalar
# cvRound uses nearest-even. Scope the correction to warp kernels rather than
# changing other SIMD image operations.
round_macro = '''
#if CV_WASM_SIMD
#define CHILLI_WARP_ROUND(a) v_int32(wasm_i32x4_trunc_sat_f32x4(wasm_f32x4_nearest((a).val)))
#else
#define CHILLI_WARP_ROUND(a) v_round(a)
#endif
'''
text = warp.read_text()
if '#define CHILLI_WARP_ROUND' not in text:
    marker = '#include "opencv2/core/hal/intrin.hpp"'
    text = text.replace('v_round(', 'CHILLI_WARP_ROUND(')
    text = text.replace(marker, marker + '\n' + round_macro)
    warp.write_text(text)
vector = source / 'modules/imgproc/src/warp_common.vector.hpp'
text = vector.read_text()
patched = text.replace('v_round(', 'CHILLI_WARP_ROUND(')
if patched != text:
    vector.write_text(patched)

# adaptiveThreshold converts the float Gaussian mean back to uint8. Match the
# scalar conversion's nearest-even ties here as well, without changing the
# Gaussian calculation, adaptive-threshold rule, or unrelated conversions.
convert = source / 'modules/core/src/convert.hpp'
old = '''static inline void v_store_pair_as(uchar* ptr, const v_float32& a, const v_float32& b)
{ v_pack_u_store(ptr, v_pack(v_round(a), v_round(b))); }'''
new = '''static inline void v_store_pair_as(uchar* ptr, const v_float32& a, const v_float32& b)
{
#if CV_WASM_SIMD
    // CHILLI_SIMD_CONVERSION: preserve scalar cvRound nearest-even ties.
    v_int32 ia(wasm_i32x4_trunc_sat_f32x4(wasm_f32x4_nearest(a.val)));
    v_int32 ib(wasm_i32x4_trunc_sat_f32x4(wasm_f32x4_nearest(b.val)));
    v_pack_u_store(ptr, v_pack(ia, ib));
#else
    v_pack_u_store(ptr, v_pack(v_round(a), v_round(b)));
#endif
}'''
text = convert.read_text()
if old not in text and new not in text:
    raise SystemExit('Pinned OpenCV uint8 conversion source no longer matches the build patch')
patched = text.replace(old, new)
if patched != text:
    convert.write_text(patched)
