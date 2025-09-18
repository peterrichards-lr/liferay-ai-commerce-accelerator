import ClayAlert from "@clayui/alert";

export default function GlobalDisclaimer() {
  return (
    <ClayAlert displayType="warning" className="mb-3" title="Important">
      This configuration is intended for demonstrations and internal testing only. Do not use in production.
    </ClayAlert>
  );
}