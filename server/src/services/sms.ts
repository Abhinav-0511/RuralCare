/**
 * Outgoing SMS. Only a console sender exists for this project; a real provider (e.g. an Indian
 * DLT-registered gateway) implements the same interface and is selected with SMS_PROVIDER.
 */
export interface SmsSender {
  send(phone: string, text: string): Promise<void>;
}

const mask = (phone: string) => `${phone.slice(0, 2)}******${phone.slice(-2)}`;

/** Mock: writes the message to the server log instead of sending it. */
export function createConsoleSms(log: (line: string) => void = console.log): SmsSender {
  return {
    async send(phone, text) {
      log(`[sms:console] to ${mask(phone)}: ${text}`);
    },
  };
}

export function createSmsSender(provider: 'console'): SmsSender {
  switch (provider) {
    case 'console':
      return createConsoleSms();
  }
}
