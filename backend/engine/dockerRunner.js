import { spawn } from 'child_process';

const EXECUTION_TIMEOUT = 3000;
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

function validateCode(code, language) {
  if (typeof code !== 'string') {
    return { valid: false, error: 'Code must be a string' };
  }

  if (code.length === 0) {
    return { valid: false, error: 'Code cannot be empty' };
  }

  if (code.length > MAX_CODE_LENGTH) {
    return { valid: false, error: `Code exceeds maximum length of ${MAX_CODE_LENGTH} characters` };
  }

  if (!LANGUAGE_CONFIGS[language]) {
    return { valid: false, error: `Unsupported language: ${language}` };
  }

  return { valid: true };
}

export async function executeCodeInDocker(code, language = 'javascript', sendMessage = null) {
  // Validate input
  const validation = validateCode(code, language);
  if (!validation.valid) {
    if (sendMessage) {
      sendMessage({ type: 'error', data: validation.error });
      sendMessage({ type: 'end' });
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
    let childExited = false;

    if (sendMessage) {
      sendMessage({ type: 'start' });
    }

    // Build Docker arguments array to prevent shell injection
    const dockerArgs = [
      'run',
      '--rm',
      '--memory=64m',
      '--cpus=0.5',
      '--network=none',
      '--read-only',
      '--pids-limit=64',
      '--security-opt=no-new-privileges',
      '--tmpfs=/tmp:noexec,nosuid,nodev',
      '--interactive',
      '--attach=stdin',
      '--attach=stdout',
      '--attach=stderr'
    ];

    // Add environment variables
    config.env.forEach(env => {
      dockerArgs.push('-e', env);
    });

    // Add image and command
    dockerArgs.push(config.image, config.command);
    dockerArgs.push(...config.args);

    const child = spawn('docker', dockerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Write code to stdin
    child.stdin.write(code);
    child.stdin.end();

    let timeoutId = setTimeout(() => {
      if (!childExited) {
        child.kill('SIGKILL'); // Use SIGKILL for guaranteed termination
        hasError = true;
        const errorMsg = `Execution timeout exceeded: ${EXECUTION_TIMEOUT}ms`;
        if (sendMessage) {
          sendMessage({ type: 'error', data: errorMsg });
          sendMessage({ type: 'end' });
        }
        resolve({
          success: false,
          output: '',
          error: errorMsg
        });
      }
    }, EXECUTION_TIMEOUT);

    child.stdout.on('data', (chunk) => {
      const data = chunk.toString();
      output += data;
      if (sendMessage) {
        sendMessage({ type: 'output', data });
      }
    });

    child.stderr.on('data', (chunk) => {
      const data = chunk.toString();
      output += data;
      if (sendMessage) {
        sendMessage({ type: 'error', data });
      }
    });

    child.on('close', (code) => {
      childExited = true;
      clearTimeout(timeoutId);
      if (!hasError) {
        if (sendMessage) {
          sendMessage({ type: 'end' });
        }
        resolve({
          success: code === 0,
          output: output.trim() || (code === 0 ? '✅ Code executed successfully' : ''),
          error: code !== 0 ? `Process exited with code ${code}` : null
        });
      }
    });

    child.on('error', (err) => {
      childExited = true;
      clearTimeout(timeoutId);
      hasError = true;
      const errorMsg = err.message || 'Unknown error';
      if (sendMessage) {
        sendMessage({ type: 'error', data: errorMsg });
        sendMessage({ type: 'end' });
      }
      resolve({
        success: false,
        output: '',
        error: errorMsg
      });
    });
  });
}
