import { aiBestMove } from './rules_ai';

// Listen for messages from the main thread
self.onmessage = (e: MessageEvent) => {
  const { board, player, depth, chainCaptureFrom } = e.data;

  try {
    // Perform the heavy calculation
    const bestSequence = aiBestMove(board, player, depth, chainCaptureFrom);
    
    // Send the result back
    self.postMessage({ type: 'SUCCESS', move: bestSequence });
  } catch (error) {
    console.error("AI Worker Error:", error);
    self.postMessage({ type: 'ERROR', error });
  }
};
