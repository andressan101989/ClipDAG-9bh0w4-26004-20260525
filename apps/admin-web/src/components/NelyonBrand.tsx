import nelyonWordmark from "../../../../assets/branding/nelyon/v1/nelyon-wordmark-on-dark.png";

export function NelyonBrand({ role }: { role?: string }) {
  return (
    <div className="brand">
      <img className="brand-logo" src={nelyonWordmark} alt="Nelyon" />
      <small>
        Admin Console
        {role ? <em>{role}</em> : null}
      </small>
    </div>
  );
}
