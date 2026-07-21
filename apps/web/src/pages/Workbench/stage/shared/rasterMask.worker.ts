import { decodeCocoRle, type CocoRle } from "./geometry/maskRle";
import { analyzeRasterMaskAlpha, type RasterMaskAnalysis } from "./rasterMaskRender";

type WorkerRequest = { id: number; rle: CocoRle };
type WorkerResponse =
  | { id: number; ok: true; analysis: RasterMaskAnalysis }
  | { id: number; ok: false; error: string };

type WorkerScope = {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
};

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  const { id, rle } = event.data;
  try {
    const [height, width] = rle.size;
    const analysis = analyzeRasterMaskAlpha(decodeCocoRle(rle), width, height);
    const response: WorkerResponse = { id, ok: true, analysis };
    workerScope.postMessage(response, [analysis.crop.alpha.buffer]);
  } catch (error) {
    workerScope.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
