// モーダル右上の閉じるボタン。矢印アイコンと同じピクセル調の「X」
export default function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="close-x" aria-label={label} title={label} onClick={onClick}>
      <svg viewBox="0 0 7 7" aria-hidden="true">
        <path d="M0 0h1v1H0zM6 0h1v1H6zM1 1h1v1H1zM5 1h1v1H5zM2 2h1v1H2zM4 2h1v1H4zM3 3h1v1H3zM2 4h1v1H2zM4 4h1v1H4zM1 5h1v1H1zM5 5h1v1H5zM0 6h1v1H0zM6 6h1v1H6z" />
      </svg>
    </button>
  );
}
