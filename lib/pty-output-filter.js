const OSC_PREFIX = '\x1b]1337;';
const TM_CMD_PREFIX = 'tm-cmd;';
const TM_PROMPT = 'tm-prompt';

/**
 * Stateful filter for PTY output: strips app OSC markers, tracks alternate screen.
 */
class PtyOutputFilter {
  constructor() {
    this._carry = '';
    this.alternateScreen = false;
    this._lastAlternateScreen = false;
  }

  /**
   * @param {string} chunk
   * @returns {{ output: string, commands: string[], prompt: boolean }}
   */
  process(chunk) {
    const input = this._carry + chunk;
    this._carry = '';

    let output = '';
    const commands = [];
    let prompt = false;
    let i = 0;

    while (i < input.length) {
      const altEnter = input.indexOf('\x1b[?1049h', i);
      const altExit = input.indexOf('\x1b[?1049l', i);
      const altEnterOld = input.indexOf('\x1b[?47h', i);
      const altExitOld = input.indexOf('\x1b[?47l', i);
      const osc = input.indexOf(OSC_PREFIX, i);

      const candidates = [
        altEnter >= 0 ? altEnter : Infinity,
        altExit >= 0 ? altExit : Infinity,
        altEnterOld >= 0 ? altEnterOld : Infinity,
        altExitOld >= 0 ? altExitOld : Infinity,
        osc >= 0 ? osc : Infinity,
      ];
      const nextSpecial = Math.min(...candidates);

      if (nextSpecial === Infinity) {
        output += input.slice(i);
        break;
      }

      output += input.slice(i, nextSpecial);

      if (nextSpecial === altEnter || nextSpecial === altEnterOld) {
        this.alternateScreen = true;
        const seq = nextSpecial === altEnter ? '\x1b[?1049h' : '\x1b[?47h';
        output += seq;
        i = nextSpecial + seq.length;
        continue;
      }

      if (nextSpecial === altExit || nextSpecial === altExitOld) {
        this.alternateScreen = false;
        const seq = nextSpecial === altExit ? '\x1b[?1049l' : '\x1b[?47l';
        output += seq;
        i = nextSpecial + seq.length;
        continue;
      }

      // OSC sequence: ESC ] ... BEL or ESC \
      const endBel = input.indexOf('\x07', nextSpecial);
      const endSt = input.indexOf('\x1b\\', nextSpecial);
      let end = -1;
      let endLen = 0;
      if (endBel >= 0 && (endSt < 0 || endBel < endSt)) {
        end = endBel;
        endLen = 1;
      } else if (endSt >= 0) {
        end = endSt;
        endLen = 2;
      }

      if (end < 0) {
        this._carry = input.slice(nextSpecial);
        break;
      }

      const payload = input.slice(nextSpecial + OSC_PREFIX.length, end);
      i = end + endLen;

      if (payload === TM_PROMPT) {
        prompt = true;
        continue;
      }

      if (payload.startsWith(TM_CMD_PREFIX)) {
        const encoded = payload.slice(TM_CMD_PREFIX.length);
        try {
          const command = Buffer.from(encoded, 'base64').toString('utf8');
          if (command) commands.push(command);
        } catch {
          // ignore malformed payloads
        }
        continue;
      }

      // Unknown OSC — forward intact
      output += input.slice(nextSpecial, i);
    }

    return { output, commands, prompt };
  }
}

module.exports = { PtyOutputFilter, OSC_PREFIX, TM_CMD_PREFIX, TM_PROMPT };
