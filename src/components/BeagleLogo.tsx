interface BeagleLogoProps {
  className?: string;
  size?: number;
}
export function BeagleLogo({ className = "", size = 36 }: BeagleLogoProps) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}brand/beagledock-logo.png`}
      width={size}
      height={size}
      alt="BeagleDock — mascote beagle"
      className={`object-contain shrink-0 ${className}`}
      draggable={false}
    />
  );
}
