import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let gatewayProcess = null;
const API_PORT = '2785';
const API_KEY = 'default_master_key_for_emi_tracker_999';
const SESSION_NAME = 'default-session';
let sessionUuid = null; // Stored session UUID resolved from database

export const getSessionUuid = () => sessionUuid;

export const initOpenWA = () => {
  if (gatewayProcess) return Promise.resolve();

  return new Promise((resolve, reject) => {
    console.log('[OpenWA Client] Starting standalone OpenWA API Gateway (Baileys socket engine)...');
    
    const gatewayPath = path.join(process.cwd(), 'node_modules', 'openwa');
    
    const env = {
      ...process.env,
      PORT: API_PORT, // Force OpenWA to bind to 2785, overriding inherited PORT (e.g. 5000)
      API_PORT,
      ENGINE_TYPE: 'baileys', // Socket engine: extremely stable, no Chromium/Puppeteer issues
      DATABASE_TYPE: 'sqlite',
      STORAGE_TYPE: 'local',
      REDIS_ENABLED: 'false',
      QUEUE_ENABLED: 'false',
      SERVE_DASHBOARD: 'true',
      ENABLE_SWAGGER: 'true',
      API_MASTER_KEY: API_KEY,
      AUTO_START_SESSIONS: 'true',
      LOG_LEVEL: 'info',
    };

    gatewayProcess = spawn('node', ['dist/main.js'], {
      cwd: gatewayPath,
      env,
      stdio: 'pipe',
      shell: true
    });

    let resolved = false;

    // Pipe stdout to parent process so QR code & startup logs are visible
    gatewayProcess.stdout.on('data', (data) => {
      const output = data.toString();
      process.stdout.write(output);

      // Check if server is running
      if (output.includes('OpenWA is running on') && !resolved) {
        resolved = true;
        
        // Wait 3 seconds for services to settle, then initialize default session
        setTimeout(async () => {
          try {
            console.log('[OpenWA Client] Registering default WhatsApp session on gateway...');
            
            // Create session
            const createRes = await fetch(`http://localhost:${API_PORT}/api/sessions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY
              },
              body: JSON.stringify({
                name: SESSION_NAME // Must use 'name' instead of 'sessionId'
              })
            });

            if (createRes.ok) {
              const sessionData = await createRes.json();
              sessionUuid = sessionData.id;
              console.log(`[OpenWA Client] Default session registered. UUID: ${sessionUuid}`);
            } else if (createRes.status === 409) {
              // Session already exists, let's fetch its UUID
              console.log('[OpenWA Client] Session already exists. Fetching UUID...');
              const listRes = await fetch(`http://localhost:${API_PORT}/api/sessions`, {
                headers: {
                  'X-API-Key': API_KEY
                }
              });
              if (listRes.ok) {
                const sessions = await listRes.json();
                const defaultSess = sessions.find(s => s.name === SESSION_NAME);
                if (defaultSess) {
                  sessionUuid = defaultSess.id;
                  console.log(`[OpenWA Client] Resolved existing session UUID: ${sessionUuid}`);
                }
              }
            } else {
              const errBody = await createRes.json().catch(() => ({}));
              console.error('[OpenWA Client] Failed to create session:', errBody.message || createRes.statusText);
            }

            if (sessionUuid) {
              // Start session using its UUID
              console.log('[OpenWA Client] Connecting default WhatsApp session...');
              await fetch(`http://localhost:${API_PORT}/api/sessions/${sessionUuid}/start`, {
                method: 'POST',
                headers: {
                  'X-API-Key': API_KEY
                }
              });

              console.log('[OpenWA Client] OpenWA Gateway started successfully! Link at http://localhost:5173/api/loans/whatsapp-qr');
            } else {
              console.error('[OpenWA Client] Could not resolve session UUID. Start aborted.');
            }
            resolve();
          } catch (err) {
            console.error('[OpenWA Client] Failed to register/start session:', err.message);
            resolve(); // Still resolve so backend startup isn't blocked
          }
        }, 3000);
      }
    });

    gatewayProcess.stderr.on('data', (data) => {
      process.stderr.write(data.toString());
    });

    gatewayProcess.on('error', (err) => {
      console.error('[OpenWA Client] Subprocess error:', err);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    gatewayProcess.on('exit', (code) => {
      console.log(`[OpenWA Client] Gateway subprocess exited with code ${code}`);
      gatewayProcess = null;
      sessionUuid = null;
    });
  });
};

export const getWAClient = () => {
  return {
    sendText: async (chatId, text) => {
      if (!sessionUuid) {
        throw new Error('OpenWA Gateway is still initializing. Please wait a moment and try again.');
      }
      
      const formattedChatId = chatId.includes('@') ? chatId : `${chatId}@c.us`;
      console.log(`[OpenWA Client] Dispatching message via gateway API to ${formattedChatId}...`);

      const response = await fetch(`http://localhost:${API_PORT}/api/sessions/${sessionUuid}/messages/send-text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY
        },
        body: JSON.stringify({
          chatId: formattedChatId,
          text
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || `Gateway returned status ${response.status}`);
      }

      const resData = await response.json();
      return resData.messageId || 'wa_openwa_' + Math.random().toString(36).substring(2, 11);
    }
  };
};
