// 右上の閉じるボタン。細い線 2 本の「X」
export default function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="close-x" aria-label={label} title={label} onClick={onClick}>
      <svg viewBox="0 0 28 28" aria-hidden="true">
        <path d="M1 1L27 27M27 1L1 27" />
      </svg>
    </button>
  );
}
