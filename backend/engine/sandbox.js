import { spawn } from 'child_process';

/**
 * SECURE SANDBOX - Executes untrusted code in isolation
 * 
 * Security Features:
 * ✅ 5-second execution timeout (prevents infinite loops)
 * ✅ 64MB memory limit (prevents memory bombs)
 * ✅ No network access (--network=none)
 * ✅ No filesystem access (--read-only)
 * ✅ No new privileges (--security-opt=no-new-privileges)
 * ✅ Limited processes (--pids-limit=64)
 */

const EXECUTION_TIMEOUT = 5000;  // 5 seconds max
const MAX_CODE_LENGTH = 3000;

const LANGUAGE_CONFIGS = {
  javascript: {
    image: 'node:18-alpine',
    command: 'node',
    args: ['-'],
    env: ['NODE_OPTIONS=--max-old-space-size=64'],
  },
  python: {
    image: 'python:3.11-alpine',
    command: 'python3',
    args: ['-'],
    env: [],
  },
};

/**
 * Validates code before execution
 */
function validateCode(code, language) {
  if (typeof code !== 'string') {
    return { valid: false, error: 'Code must be a string' };
  }

  if (code.trim().length === 0) {
    return { valid: false, error: 'Code cannot be empty' };
  }

  if (code.length > MAX_CODE_LENGTH) {
    return { valid: false, error: `Code exceeds ${MAX_CODE_LENGTH} char limit` };
  }

  if (!LANGUAGE_CONFIGS[language]) {
    return { valid: false, error: `Language not supported: ${language}` };
  }

  return { valid: true };
}

/**
 * Executes code in a Docker container sandbox
 * @param {string} code - The code to execute
 * @param {string} language - 'javascript' or 'python'
 * @param {Function} onMessage - Optional callback for streaming output
 * @returns {Promise} { success, output, error }
 */
export async function executeSandbox(code, language = 'javascript', onMessage = null) {
  // Step 1: Validate input
  const validation = validateCode(code, language);
  if (!validation.valid) {
    if (onMessage) {
      onMessage({ type: 'error', data: validation.error });
      onMessage({ type: 'end' });
    }
    return {
      success: false,
      output: '',
      error: validation.error
    };
  }

  const config = LANGUAGE_CONFIGS[language];

  return new Promise((resolve) => {
    let output = '';
    let hasError = false;
    let processExited = false;

    if (onMessage) {
      onMessage({ type: 'start' });
    }

    // Step 2: Build Docker security arguments (prevents shell injection)
    const dockerArgs = [
      'run',
      '--rm',                           // Remove container after execution
      '--memory=64m',                    // Memory limit: 64MB
      '--cpus=0.5',                      // CPU limit: 50% of 1 core
      '--network=none',                  // No network access
      '--read-only',                     // Filesystem is read-only
      '--pids-limit=64',                 // Max 64 processes
      '--security-opt=no-new-privileges', // No privilege escalation
      '--tmpfs=/tmp:noexec,nosuid,nodev', // /tmp with execution disabled
      '--interactive',
      '--attach=stdin',
      '--attach=stdout',
      '--attach=stderr'
    ];

    // Add environment variables
    config.env.forEach(env => dockerArgs.push('-e', env));

    // Add Docker image and command
    dockerArgs.push(config.image, config.command, ...config.args);

    // Step 3: Spawn Docker process
    const child = spawn('docker', dockerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Step 4: Send code and close stdin
    child.stdin.write(code);
    child.stdin.end();

    // Step 5: Set timeout (kills process if it exceeds limit)
    let timeoutId = setTimeout(() => {
      if (!processExited) {
        child.kill('SIGKILL');
        processExited = true;
        hasError = true;
        const errorMsg = `⏱️ Execution timeout exceeded (${EXECUTION_TIMEOUT}ms)`;
        if (onMessage) {
          onMessage({ type: 'error', data: errorMsg });
          onMessage({ type: 'end' });
        }
        resolve({
          success: false,
          output: '',
          error: errorMsg
        });
      }
    }, EXECUTION_TIMEOUT);

    // Step 6: Capture stdout
    child.stdout.on('data', (chunk) => {
      const data = chunk.toString();
      output += data;
      if (onMessage) {
        onMessage({ type: 'output', data });
      }
    });

    // Step 7: Capture stderr
    child.stderr.on('data', (chunk) => {
      const data = chunk.toString();
      output += data;
      if (onMessage) {
        onMessage({ type: 'error', data });
      }
    });

    // Step 8: Handle process close
    child.on('close', (exitCode) => {
      processExited = true;
      clearTimeout(timeoutId);

      if (!hasError) {
        if (onMessage) {
          onMessage({ type: 'end' });
        }
        resolve({
          success: exitCode === 0,
          output: output.trim() || (exitCode === 0 ? '✅ Code executed successfully' : ''),
          error: exitCode !== 0 ? `Process exited with code ${exitCode}` : null
        });
      }
    });

    // Step 9: Handle Docker spawn errors (e.g., Docker not running)
    child.on('error', (err) => {
      processExited = true;
      clearTimeout(timeoutId);
      hasError = true;

      const errorMsg = `Docker error: ${err.message}`;
      if (onMessage) {
        onMessage({ type: 'error', data: errorMsg });
        onMessage({ type: 'end' });
      }
      resolve({
        success: false,
        output: '',
        error: errorMsg
      });
    });
  });
}