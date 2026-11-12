// Peer-to-peer rooms over WebRTC (PeerJS). The host is the hub: guests talk to the host, the host relays.
export class Net {
  constructor() { this.peer = null; this.conns = new Map(); this.isHost = false; this.id = null; this.handlers = {}; this.code = ''; this.hostConn = null; }
  on(t, fn) { this.handlers[t] = fn; }
  _emit(m, from) { const h = this.handlers[m.t]; if (h) h(m, m.from || from); } // m.from is the original sender even when the host relayed it
  host(code) {
    return new Promise((res, rej) => {
      this.isHost = true; this.code = code;
      this.peer = new Peer('hollowgames-' + code);
      const to = setTimeout(() => rej(new Error('Could not reach the matchmaking service.')), 9000);
      this.peer.on('open', id => { clearTimeout(to); this.id = id; res(id); });
      this.peer.on('error', e => { clearTimeout(to); rej(new Error(e.type === 'unavailable-id' ? 'Room code taken — try again.' : 'Network error: ' + e.type)); });
      this.peer.on('connection', c => this._accept(c));
    });
  }
  _accept(c) {
    c.on('open', () => { this.conns.set(c.peer, c); this._emit({ t: 'peer+', id: c.peer }, c.peer); });
    c.on('data', m => { this._emit(m, c.peer); this._relay(m, c.peer); });
    c.on('close', () => { this.conns.delete(c.peer); this._emit({ t: 'peer-', id: c.peer }, c.peer); this._relay({ t: 'left', id: c.peer }, c.peer); this._emit({ t: 'left', id: c.peer }, c.peer); });
  }
  _relay(m, from) { if (!this.isHost || m.to === this.id) return; for (const [id, c] of this.conns) if (id !== from && c.open && (!m.to || m.to === id)) c.send(m); }
  join(code) {
    return new Promise((res, rej) => {
      this.isHost = false; this.code = code; this.peer = new Peer();
      const to = setTimeout(() => rej(new Error('Room not found.')), 10000);
      this.peer.on('open', id => {
        this.id = id; const c = this.peer.connect('hollowgames-' + code, { reliable: false });
        c.on('open', () => { clearTimeout(to); this.hostConn = c; this.conns.set(c.peer, c); res(c.peer); });
        c.on('data', m => this._emit(m, c.peer));
        c.on('close', () => this._emit({ t: 'closed' }, c.peer));
      });
      this.peer.on('error', e => { clearTimeout(to); rej(new Error(e.type === 'peer-unavailable' ? 'Room not found.' : 'Network error: ' + e.type)); });
    });
  }
  send(m) { m.from = this.id; if (this.isHost) { for (const c of this.conns.values()) if (c.open && (!m.to || m.to === c.peer)) c.send(m); } else if (this.hostConn && this.hostConn.open) this.hostConn.send(m); }
  close() { try { this.peer && this.peer.destroy(); } catch (e) { } this.peer = null; this.conns.clear(); this.hostConn = null; }
}
