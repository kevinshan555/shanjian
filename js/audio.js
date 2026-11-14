/* 山间 · 静心空间
 * 所有声音均由 Web Audio 实时合成，不加载任何音频文件。
 */
(function () {
  "use strict";

  var Sound = function () {
    this.ctx = null;
    this.master = null;
    this.ready = false;
    this.enabled = false;
    this.volume = 0.55;
    this.ambience = { wind: true, birds: true, stream: true, bell: true };
    this._nodes = {};
    this._timers = [];
    this._hidden = false;
  };

  Sound.prototype.init = function () {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.0001;
    this.master.connect(this.ctx.destination);

    this._buildNoise();
    this._buildWind();
    this._buildStream();
    this._scheduleBirds();
    this._scheduleBell();
    this.ready = true;

    var self = this;
    document.addEventListener("visibilitychange", function () {
      if (!self.ctx) return;
      if (document.hidden) {
        self.ctx.suspend();
      } else {
        self.ctx.resume();
      }
    });
  };

  Sound.prototype._buildNoise = function () {
    var ctx = this.ctx;
    var len = ctx.sampleRate * 3;
    var buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) {
      var white = Math.random() * 2 - 1;
      // 轻微粉噪化，听感更自然
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2 + white * 0.16;
    }
    this._noiseBuffer = buffer;
  };

  Sound.prototype._loopNoise = function () {
    var src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    return src;
  };

  Sound.prototype._buildWind = function () {
    var ctx = this.ctx;
    var out = ctx.createGain();
    out.gain.value = 0.0;
    out.connect(this.master);

    var filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 360;
    filter.Q.value = 0.6;

    var src = this._loopNoise();
    src.connect(filter);
    filter.connect(out);

    // 缓慢起伏
    var lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.06;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    this._nodes.wind = out;
    this._fade(out.gain, this.ambience.wind ? 0.16 : 0.0, 1.4);
  };

  Sound.prototype._buildStream = function () {
    var ctx = this.ctx;
    var out = ctx.createGain();
    out.gain.value = 0.0;
    out.connect(this.master);

    var filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1150;
    filter.Q.value = 0.8;

    var src = this._loopNoise();
    src.connect(filter);
    filter.connect(out);

    var lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.13;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    this._nodes.stream = out;
    this._fade(out.gain, this.ambience.stream ? 0.055 : 0.0, 1.4);
  };

  Sound.prototype._scheduleBirds = function () {
    var self = this;
    var next = 5000 + Math.random() * 7000;
    this._timers.push(setTimeout(function tick() {
      if (self.enabled && self.ambience.birds) self._chirp();
      next = 4500 + Math.random() * 9000;
      self._timers.push(setTimeout(tick, next));
    }, next));
  };

  Sound.prototype._chirp = function () {
    if (!this.ctx || !this.enabled) return;
    var ctx = this.ctx;
    var now = ctx.currentTime;
    var notes = 2 + Math.floor(Math.random() * 3);
    var base = 1900 + Math.random() * 900;
    var pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    var out = ctx.createGain();
    out.gain.value = 0.0001;
    if (pan) {
      pan.pan.value = Math.random() * 1.4 - 0.7;
      out.connect(pan);
      pan.connect(this.master);
    } else {
      out.connect(this.master);
    }
    for (var i = 0; i < notes; i++) {
      var t = now + i * (0.09 + Math.random() * 0.06);
      var osc = ctx.createOscillator();
      osc.type = "sine";
      var f = base * (1 + Math.random() * 0.35);
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 1.22, t + 0.05);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.022, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + 0.14);
    }
    out.gain.setValueAtTime(0.0001, now);
    out.gain.linearRampToValueAtTime(1, now + 0.01);
    out.gain.setValueAtTime(1, now + 0.9);
    out.gain.linearRampToValueAtTime(0.0001, now + 1.1);
  };

  Sound.prototype._scheduleBell = function () {
    var self = this;
    var next = 12000 + Math.random() * 14000;
    this._timers.push(setTimeout(function tick() {
      if (self.enabled && self.ambience.bell) self._bell(196, 0.045, 6.5);
      next = 22000 + Math.random() * 26000;
      self._timers.push(setTimeout(tick, next));
    }, next));
  };

  Sound.prototype._bell = function (freq, gainValue, decay) {
    if (!this.ctx || !this.enabled) return;
    var ctx = this.ctx;
    var now = ctx.currentTime;
    var partials = [1, 2.01, 2.98, 4.16, 5.43];
    var gains = [1, 0.5, 0.28, 0.16, 0.08];
    var out = ctx.createGain();
    out.gain.value = 0.0001;
    out.connect(this.master);
    var filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 3200;
    filter.connect(out);

    for (var i = 0; i < partials.length; i++) {
      var osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq * partials[i];
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(gainValue * gains[i], now + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay * (1 - i * 0.16));
      osc.connect(g);
      g.connect(filter);
      osc.start(now);
      osc.stop(now + decay + 0.2);
    }
    out.gain.setValueAtTime(0.0001, now);
    out.gain.linearRampToValueAtTime(1, now + 0.02);
    out.gain.setValueAtTime(1, now + decay * 0.5);
    out.gain.linearRampToValueAtTime(0.0001, now + decay + 0.1);
  };

  Sound.prototype.setEnabled = function (on) {
    this.enabled = !!on;
    if (!this.ctx) return;
    this._fade(this.master.gain, this.enabled ? this.volume : 0.0001, 0.8);
  };

  Sound.prototype.setVolume = function (v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.enabled) this._fade(this.master.gain, this.volume, 0.4);
  };

  Sound.prototype.setAmbience = function (name, on) {
    this.ambience[name] = !!on;
    if (!this.ctx) return;
    var node = this._nodes[name];
    if (!node) return;
    var targets = { wind: 0.16, stream: 0.055 };
    this._fade(node.gain, on ? targets[name] || 0.05 : 0.0, 0.6);
  };

  Sound.prototype.playWoodfish = function () {
    if (!this.ctx || !this.enabled) return;
    var ctx = this.ctx;
    var now = ctx.currentTime;

    // 木质敲击：短噪声 + 两个共振峰
    var noise = ctx.createBufferSource();
    var len = Math.floor(ctx.sampleRate * 0.06);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    noise.buffer = buf;

    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 780;
    bp.Q.value = 3.5;
    var g = ctx.createGain();
    g.gain.value = 0.5;
    noise.connect(bp);
    bp.connect(g);
    g.connect(this.master);

    var osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.09);
    var og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(0.28, now + 0.008);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(og);
    og.connect(this.master);

    noise.start(now);
    noise.stop(now + 0.08);
    osc.start(now);
    osc.stop(now + 0.16);
  };

  Sound.prototype.playClick = function () {
    if (!this.ctx || !this.enabled) return;
    var ctx = this.ctx;
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1500, now);
    osc.frequency.exponentialRampToValueAtTime(900, now + 0.03);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.06, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.06);
  };

  Sound.prototype.playEnter = function () {
    if (!this.ctx) return;
    this._bell(261.63, 0.05, 7.5);
    var self = this;
    setTimeout(function () {
      if (self.ctx) self._bell(392.0, 0.035, 6.5);
    }, 650);
  };

  Sound.prototype._fade = function (param, target, seconds) {
    var now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(Math.max(0.0001, param.value), now);
    param.exponentialRampToValueAtTime(Math.max(0.0001, target), now + seconds);
  };

  window.Sound = new Sound();
})();
