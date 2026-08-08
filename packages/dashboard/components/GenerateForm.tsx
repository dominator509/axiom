'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const PLATFORMS = [
  'instagram',
  'tiktok',
  'x',
  'youtube',
  'reddit',
  'threads',
  'discord',
  'telegram',
  'facebook',
  'snapchat',
  'fanvue',
];

export default function GenerateForm({ modelId }: { modelId: string }) {
  const router = useRouter();
  const [style, setStyle] = useState('studio');
  const [outfit, setOutfit] = useState('summer dress');
  const [location, setLocation] = useState('studio');
  const [mood, setMood] = useState('energetic');
  const [lighting, setLighting] = useState('soft studio');
  const [aspectRatio, setAspectRatio] = useState('4:5');
  const [platforms, setPlatforms] = useState<string[]>(['instagram']);
  const [enrich, setEnrich] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    variants: Array<{ styleLabel: string; caption: string; hashtags: string[] }>;
    tosReport: {
      verdict: string;
      scores: Array<{ platform: string; verdict: string; score: number }>;
    };
  } | null>(null);

  function togglePlatform(p: string) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/v1/models/${modelId}/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          style,
          outfit,
          location,
          mood,
          lighting,
          aspectRatio,
          platforms,
          enrichWithLlm: enrich,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.error?.message ?? 'Generation failed');
        return;
      }
      const body = await res.json();
      setResult(body.data);
      router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Create content</h2>
      <form onSubmit={onSubmit} className="stack" style={{ maxWidth: 640 }}>
        <div className="grid">
          <div>
            <label htmlFor="style">Style</label>
            <input id="style" value={style} onChange={(e) => setStyle(e.target.value)} />
          </div>
          <div>
            <label htmlFor="outfit">Outfit</label>
            <input id="outfit" value={outfit} onChange={(e) => setOutfit(e.target.value)} />
          </div>
          <div>
            <label htmlFor="location">Location</label>
            <input id="location" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div>
            <label htmlFor="mood">Mood</label>
            <input id="mood" value={mood} onChange={(e) => setMood(e.target.value)} />
          </div>
          <div>
            <label htmlFor="lighting">Lighting</label>
            <input id="lighting" value={lighting} onChange={(e) => setLighting(e.target.value)} />
          </div>
          <div>
            <label htmlFor="aspectRatio">Aspect ratio</label>
            <select
              id="aspectRatio"
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
            >
              {['4:5', '9:16', '1:1', '16:9'].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label>Platforms</label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                className={`btn ${platforms.includes(p) ? '' : 'secondary'}`}
                style={{ padding: '4px 10px', fontSize: 12 }}
                onClick={() => togglePlatform(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <label className="row" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={enrich}
            onChange={(e) => setEnrich(e.target.checked)}
            style={{ width: 'auto' }}
          />
          Enrich captions via LLM gateway (optional, live provider call)
        </label>
        {error && <p style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
        <div>
          <button className="btn" type="submit" disabled={busy || platforms.length === 0}>
            {busy ? 'Generating…' : 'Generate 5-shot bundle'}
          </button>
        </div>
      </form>

      {result && (
        <div style={{ marginTop: 20 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>ToS report</h3>
            <span
              className={`badge ${result.tosReport.verdict === 'pass' ? 'good' : result.tosReport.verdict === 'review' ? 'warn' : 'bad'}`}
            >
              {result.tosReport.verdict}
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Platform</th>
                <th>Score</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {result.tosReport.scores.map((s) => (
                <tr key={s.platform}>
                  <td>{s.platform}</td>
                  <td>{s.score}</td>
                  <td>
                    <span
                      className={`badge ${s.verdict === 'pass' ? 'good' : s.verdict === 'review' ? 'warn' : 'bad'}`}
                    >
                      {s.verdict}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.variants.map((v, i) => (
            <div key={i} className="card" style={{ background: 'var(--panel2)' }}>
              <h3>{v.styleLabel}</h3>
              <p>{v.caption}</p>
              <p className="mono" style={{ color: 'var(--muted)' }}>
                {v.hashtags.join(' ')}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
