import PageHeader from "@/components/page-header";

export default function InboundPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Inbound packages" />
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <p className="text-sm text-slate-300">
          Track non-eBay inbound packages here. Use receiving scans to attach packages to manual
          inbound records.
        </p>
      </section>
    </div>
  );
}
