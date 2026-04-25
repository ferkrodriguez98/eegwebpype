import { HealthCheck } from "@/components/HealthCheck";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold tracking-tight">eegwebpype</h1>
      <p className="text-zinc-400">Plataforma web de preprocesamiento EEG.</p>
      <HealthCheck />
    </main>
  );
}
