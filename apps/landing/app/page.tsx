export default function Home() {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <h1 style={{ fontSize: '3rem', fontWeight: 'bold', marginBottom: '1rem', color: '#0f172a' }}>
        Frapp
      </h1>
      <p style={{ fontSize: '1.25rem', color: '#64748b', marginBottom: '2rem', textAlign: 'center', maxWidth: '600px' }}>
        The Operating System for Greek Life. Replace Discord, OmegaFi, and Life360 with a single platform.
      </p>
      <div style={{ display: 'flex', gap: '1rem' }}>
        <a
          href="https://app.frapp.live"
          style={{ padding: '0.75rem 2rem', backgroundColor: '#2563eb', color: 'white', borderRadius: '0.5rem', textDecoration: 'none', fontWeight: 600 }}
        >
          Get Started
        </a>
        <a
          href="https://app.frapp.live"
          style={{ padding: '0.75rem 2rem', border: '2px solid #2563eb', color: '#2563eb', borderRadius: '0.5rem', textDecoration: 'none', fontWeight: 600 }}
        >
          Log In
        </a>
      </div>
    </main>
  );
}
