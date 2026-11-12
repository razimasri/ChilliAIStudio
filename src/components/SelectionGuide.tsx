/** Draw-through demonstration: decorative only, with no panel or dismiss target. */
export function SelectionGuide() {
  return <div aria-hidden="true" className="mobile-selection-guide pointer-events-none absolute inset-0 z-10 flex items-center justify-center lg:hidden">
    <svg viewBox="0 0 128 160" className="pointer-events-none w-32 max-w-[50%] max-h-[50%] opacity-55" fill="none">
      <g stroke="#8c1529" strokeWidth="1.5" fill="#fff" fillOpacity=".35">
        {Array.from({ length: 20 }, (_, index) => <rect key={index} x={24 + (index % 4) * 22} y={28 + Math.floor(index / 4) * 22} width="14" height="14" rx="1" />)}
      </g>
      <g className="guide-motion" stroke="#e11d48" strokeWidth="3">
        <rect x="14" y="18" width="100" height="122" strokeDasharray="6 4">
          <animate attributeName="width" values="0;0;100;100;0" keyTimes="0;.12;.62;.9;1" dur="3.6s" repeatCount="indefinite" />
          <animate attributeName="height" values="0;0;122;122;0" keyTimes="0;.12;.62;.9;1" dur="3.6s" repeatCount="indefinite" />
        </rect>
        <circle cx="114" cy="140" r="5" fill="#e11d48" stroke="#fff" strokeWidth="1.5">
          <animate attributeName="cx" values="14;14;114;114;14" keyTimes="0;.12;.62;.9;1" dur="3.6s" repeatCount="indefinite" />
          <animate attributeName="cy" values="18;18;140;140;18" keyTimes="0;.12;.62;.9;1" dur="3.6s" repeatCount="indefinite" />
        </circle>
      </g>
      <rect className="guide-static" x="14" y="18" width="100" height="122" stroke="#e11d48" strokeWidth="3" strokeDasharray="6 4" />
    </svg>
  </div>;
}
