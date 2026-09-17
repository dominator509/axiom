import { expect, it, vi } from 'vitest';
import { confirmTransformOutput } from './media_transform.js';
const output = 'operations/example.mp4';
it('accepts the media-plane output receipt', async () => {
  await expect(confirmTransformOutput(Response.json({ status: 'ok', output_path: output }), output)).resolves.toBeUndefined();
});
it.each([{}, null, [], { status: 'pending', output_path: output }, { status: 'ok', output_path: 'another.mp4' }])('rejects unconfirmed output %#', async receipt => {
  await expect(confirmTransformOutput(Response.json(receipt), output)).rejects.toThrow('did not confirm');
});
it('does not echo an invalid response body', async () => {
  await expect(confirmTransformOutput(new Response('private provider body'), output)).rejects.toThrow(/^media plane returned an invalid transform receipt$/);
});
it('bounds receipt consumption and cancels an oversized stream', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(20_000)); }, cancel });
  await expect(confirmTransformOutput(new Response(body), output)).rejects.toThrow('maximum supported size');
  expect(cancel).toHaveBeenCalledOnce();
});
it('rejects and cancels failed HTTP responses', async () => {
  const cancel = vi.fn();
  await expect(confirmTransformOutput(new Response(new ReadableStream({ cancel }), { status: 502 }), output)).rejects.toThrow('HTTP 502');
  expect(cancel).toHaveBeenCalledOnce();
});
