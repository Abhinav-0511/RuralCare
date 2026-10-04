import { getDisclaimer, LOCALES, redFlagEngine, symptomVocabulary } from '@ruralcare/shared';

// Phase 1 placeholder: proves the shared rules are bundled into the browser build.
// The real triage UI arrives in Phase 5.
export default function App() {
  return (
    <main className="mx-auto max-w-xl p-6 font-sans text-slate-800">
      <h1 className="text-3xl font-bold text-teal-700">RuralCare</h1>
      <p className="mt-1 text-slate-600">Offline-first symptom triage</p>

      <section className="mt-6 rounded-lg border border-slate-200 p-4">
        <h2 className="font-semibold">Foundation status</h2>
        <ul className="mt-2 space-y-1 text-sm">
          <li>
            Red-flag rules v{redFlagEngine.rulesVersion} ({redFlagEngine.rules.length} rules, running in
            browser)
          </li>
          <li>Symptom vocabulary: {symptomVocabulary.symptoms.length} symptoms</li>
        </ul>
      </section>

      <section aria-label="Disclaimer" className="mt-6 space-y-2 rounded-lg bg-amber-50 p-4 text-sm">
        {LOCALES.map((locale) => (
          <p key={locale} lang={locale}>
            {getDisclaimer(locale)}
          </p>
        ))}
      </section>
    </main>
  );
}
