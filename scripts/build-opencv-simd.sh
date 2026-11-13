#!/usr/bin/env bash
set -euo pipefail

# Build with the same OpenCV release as the scalar npm runtime. Emscripten 4.0.11
# must already be installed and activated (https://emscripten.org/docs/getting_started/).
# Keep downloads/build output outside the repository; only final runtime assets ship.
CHILLI_OPENCV_COMMIT=40738fb16ceddb5fb3fea747585f7ce6abb0605b
CHILLI_OPENCV_BUILD=${1:-/tmp/chillimark-opencv-simd-build}
CHILLI_REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
: "${EMSDK:?Activate Emscripten SDK 4.0.11 before building}"
if ! emcc --version | head -1 | rg -q '4\.0\.11'; then
  echo 'This build is pinned to Emscripten 4.0.11.' >&2
  exit 1
fi
mkdir -p "$CHILLI_OPENCV_BUILD/source"
if [ ! -f "$CHILLI_OPENCV_BUILD/source/CMakeLists.txt" ]; then
  curl --fail --location --retry 3 \
    "https://github.com/opencv/opencv/archive/$CHILLI_OPENCV_COMMIT.tar.gz" \
    -o "$CHILLI_OPENCV_BUILD/source.tar.gz"
  tar -xzf "$CHILLI_OPENCV_BUILD/source.tar.gz" --strip-components=1 -C "$CHILLI_OPENCV_BUILD/source"
fi
python3 "$CHILLI_REPO_ROOT/scripts/patch-opencv-js.py" "$CHILLI_OPENCV_BUILD/source"
python3 "$CHILLI_OPENCV_BUILD/source/platforms/js/build_js.py" "$CHILLI_OPENCV_BUILD/build" \
  --config_only --build_wasm --disable_single_file --simd \
  --build_flags='-s EXPORT_ES6=1 -s ENVIRONMENT=web,worker -s DYNAMIC_EXECUTION=0' \
  --cmake_option=-DBUILD_LIST=core,imgproc,js \
  --cmake_option=-DBUILD_TESTS=OFF --cmake_option=-DBUILD_PERF_TESTS=OFF \
  --cmake_option=-DBUILD_EXAMPLES=OFF --cmake_option=-DCMAKE_CXX_STANDARD=17 \
  --cmake_option=-DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  --cmake_option=-DOPENCV_SKIP_EXTRA_COMPILER_FLAGS=ON
cmake --build "$CHILLI_OPENCV_BUILD/build" --target opencv.js --parallel "${CHILLI_BUILD_JOBS:-2}"
mkdir -p "$CHILLI_REPO_ROOT/public/opencv-simd"
cp "$CHILLI_OPENCV_BUILD/build/bin/opencv_js.js" "$CHILLI_REPO_ROOT/public/opencv-simd/opencv-5.0.0-simd.mjs"
cp "$CHILLI_OPENCV_BUILD/build/bin/opencv_js.wasm" "$CHILLI_REPO_ROOT/public/opencv-simd/opencv-5.0.0-simd.wasm"
cp "$CHILLI_OPENCV_BUILD/source/LICENSE" "$CHILLI_REPO_ROOT/public/opencv-simd/LICENSE.txt"
cp "$CHILLI_OPENCV_BUILD/source/COPYRIGHT" "$CHILLI_REPO_ROOT/public/opencv-simd/COPYRIGHT.txt"
{
  python3 - "$CHILLI_OPENCV_BUILD/source/modules/core/src/softfloat.cpp" <<'PY_LICENSE'
import pathlib, sys
print(pathlib.Path(sys.argv[1]).read_text().split('#include')[0])
PY_LICENSE
  cat "$CHILLI_OPENCV_BUILD/source/3rdparty/zlib/LICENSE"
  cat "$CHILLI_OPENCV_BUILD/source/3rdparty/dlpack/LICENSE"
  cat "$EMSDK/upstream/emscripten/LICENSE"
  cat "$EMSDK/upstream/emscripten/system/lib/libc/musl/COPYRIGHT"
} > "$CHILLI_REPO_ROOT/public/opencv-simd/THIRD_PARTY_NOTICES.txt"
(cd "$CHILLI_REPO_ROOT/public/opencv-simd" && sha256sum opencv-5.0.0-simd.mjs opencv-5.0.0-simd.wasm > SHA256SUMS)
