import { Worker } from 'bullmq';
import { executeCodeWithStream } from '../engine/runner.js';
import { connection } from './queue.js';

const results = new Map();
const connections = new Map(); // executionId -> ws

// TTL cleanup for results map (5 minutes)
const RESULT_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

function cleanupExpiredResults() {
  const now = Date.now();
  for (const [executionId, result] of results.entries()) {
    if (result.timestamp && (now - result.timestamp) > RESULT_TTL) {
      results.delete(executionId);
      connections.delete(executionId);
      console.log(`[${executionId}] Cleaned up expired result`);
    }
  }
}

// Run cleanup every minute
setInterval(cleanupExpiredResults, 60 * 1000);

export const worker = new Worker('code-execution', async (job) => {
  const { code, language, executionId } = job.data;
  const startTime = Date.now();

  console.log(`[${executionId}] Starting execution for ${language}`);

  // Update status to running
  results.set(executionId, {
    success: true,
    output: "",
    error: null,
    status: "running",
    timestamp: startTime
  });

  const ws = connections.get(executionId);
  const sendMessage = ws ? (message) => {
    // Only send if WebSocket is open (readyState === 1)
    if (ws.readyState === 1) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        console.error(`[${executionId}] Failed to send WebSocket message:`, error);
        connections.delete(executionId);
      }
    } else {
      // Remove dead connection
      connections.delete(executionId);
    }
  } : null;

  try {
    const result = await executeCodeWithStream(code, language, sendMessage);
    const executionTime = Date.now() - startTime;

    console.log(`[${executionId}] Completed in ${executionTime}ms`);

    results.set(executionId, {
      ...result,
      status: 'completed',
      executionTime,
      timestamp: Date.now(),
    });

    return result;
  } catch (error) {
    const executionTime = Date.now() - startTime;

    console.error(`[${executionId}] Failed after ${executionTime}ms: ${error.message}`);

    const errorResult = {
      success: false,
      output: '',
      error: error.message,
      status: 'failed',
      executionTime,
      timestamp: Date.now(),
    };

    results.set(executionId, errorResult);
    throw error;
  }
}, {
  connection,
  concurrency: 5,
  limiter: {
    max: 5,
    duration: 1000,
  },
});

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed: ${err.message}`);
});

export { results, connections };
