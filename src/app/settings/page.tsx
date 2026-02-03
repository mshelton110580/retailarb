import PageHeader from "@/components/page-header";

const flags = [
  { key: "FEATURE_OFFER_API", description: "Enable Offer API proxy bid feature." },
  { key: "FEATURE_PLACE_OFFER", description: "Enable Trading PlaceOffer actions." },
  { key: "PLAYWRIGHT_HEADLESS", description: "Run returns scraper in headless mode." }
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">Feature flags</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-300">
          {flags.map((flag) => (
            <li key={flag.key} className="flex items-center justify-between">
              <span>{flag.key}</span>
              <span className="text-slate-400">{flag.description}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-lg font-semibold">Encryption key</h2>
        <p className="mt-2 text-sm text-slate-300">
          Ensure ENCRYPTION_KEY is set to 32+ bytes and rotated only with token re-authentication.
        </p>
      </section>
    </div>
  );
}
