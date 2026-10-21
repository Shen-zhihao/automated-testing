import './index.less';

export default function BrandLogo({ size = 36 }: { size?: number }) {
  return (
    <img
      className="brandLogo"
      src={`${import.meta.env.BASE_URL}brand/icon.png`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
