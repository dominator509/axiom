import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./GrokConnection', () => ({ default: () => <span>grok</span> }));
vi.mock('./MediaUpload', () => ({ default: () => <span>upload</span> }));
vi.mock('./GeneratedCaptionReceipt', () => ({ default: () => <span>receipt</span> }));
vi.mock('./GenerationProgress', () => ({ default: () => <span>progress</span> }));
vi.mock('./LocaleProvider', () => ({
  useLocale: () => ({
    locale: 'ja',
    setLocale: () => undefined,
    t: (key: string, values?: Record<string, string | number>) => {
      const text = ({
        'generation.createBrief': 'コンテンツ概要を作成',
        'generation.description': '接続済みのサブスクリプションで生成します。',
        'generation.output': '出力',
        'generation.briefOnly': 'テキスト概要のみ',
        'generation.image': 'Grok画像',
        'generation.imageToVideo': 'Grok画像から動画',
        'generation.platforms': 'プラットフォーム',
        'generation.style': 'スタイル',
        'generation.outfit': '衣装',
        'generation.location': '場所',
        'generation.mood': 'ムード',
        'generation.lighting': '照明',
        'generation.aspectRatio': 'アスペクト比',
        'generation.enrichCaptions': 'LLMでキャプションを補完（任意）',
        'generation.generating': '生成中…',
        'generation.checkSameRequest': '同じ生成リクエストを確認',
        'generation.generateBrief': 'コンテンツ概要を生成',
        'generation.queueGrok': 'Grok生成をキューに追加',
      }[key] ?? key);
      return text.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_match, name: string) => String(values?.[name] ?? _match));
    },
  }),
}));
import GenerateForm from './GenerateForm';

describe('GenerateForm locale coverage', () => {
  it('renders the generation workflow shell in Japanese', () => {
    const html = renderToStaticMarkup(<GenerateForm modelId="model" />);
    expect(html).toContain('コンテンツ概要を作成');
    expect(html).toContain('プラットフォーム');
    expect(html).toContain('アスペクト比');
    expect(html).not.toContain('Create content brief');
  });
});
