/** 写真がない候補の代替表示。実際の写真に見えないよう、無地に文字だけにする */
export function Placeholder() {
  return (
    <div className="placeholder" role="img" aria-label="写真なし">
      <span>写真なし</span>
    </div>
  );
}
