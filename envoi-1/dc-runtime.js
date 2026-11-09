/* Petit moteur de rendu des pages du portfolio (gabarits {{...}}, sc-for, sc-if, dc-import). */
(function () {
  'use strict';
  var REG = {};

  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(patch) {
      if (typeof patch === 'function') { patch = patch(this.state || {}); }
      this.state = Object.assign({}, this.state || {}, patch || {});
      if (this.__root) { this.__root.schedule(); }
    }
  }

  function camel(s) { return s.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

  function lookup(scope, expr) {
    expr = expr.trim();
    if (expr === 'true') { return true; }
    if (expr === 'false') { return false; }
    if (expr === 'null') { return null; }
    if (/^-?\d+(\.\d+)?$/.test(expr)) { return parseFloat(expr); }
    var parts = expr.split('.');
    var v = scope ? scope[parts[0]] : undefined;
    for (var i = 1; i < parts.length; i++) {
      if (v === null || v === undefined) { return undefined; }
      v = v[parts[i]];
    }
    return v;
  }
  var ONE = /^\s*\{\{([^{}]+)\}\}\s*$/;
  var ANY = /\{\{([^{}]+)\}\}/g;
  function interpVal(str, scope) {
    if (str === null || str === undefined) { return undefined; }
    var m = str.match(ONE);
    if (m) { return lookup(scope, m[1]); }
    return interpStr(str, scope);
  }
  function interpStr(str, scope) {
    if (str.indexOf('{{') < 0) { return str; }
    return str.replace(ANY, function (_, p) {
      var v = lookup(scope, p);
      return (v === null || v === undefined || typeof v === 'function') ? '' : String(v);
    });
  }

  function defaultsOf(def) {
    var out = {};
    var d = def.propDefs || {};
    Object.keys(d).forEach(function (k) {
      if (k.charAt(0) === '$') { return; }
      if (d[k] && Object.prototype.hasOwnProperty.call(d[k], 'default')) { out[k] = d[k].default; }
    });
    return out;
  }

  function renderNodes(src, scope, out, ctx) {
    var kids = src.childNodes;
    for (var i = 0; i < kids.length; i++) { renderNode(kids[i], scope, out, ctx); }
  }

  function renderNode(node, scope, out, ctx) {
    if (node.nodeType === 3) { out.appendChild(document.createTextNode(interpStr(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) { return; }
    var tag = node.localName;
    if (tag === 'sc-for') {
      var list = interpVal(node.getAttribute('list'), scope) || [];
      var as = node.getAttribute('as') || 'item';
      for (var i = 0; i < list.length; i++) {
        var s = Object.create(scope);
        s[as] = list[i];
        renderNodes(node, s, out, ctx);
      }
      return;
    }
    if (tag === 'sc-if') {
      if (interpVal(node.getAttribute('value'), scope)) { renderNodes(node, scope, out, ctx); }
      return;
    }
    if (tag === 'dc-import') {
      var name = node.getAttribute('name');
      var def = REG[name];
      if (!def) { return; }
      var props = {};
      for (var a = 0; a < node.attributes.length; a++) {
        var at = node.attributes[a];
        if (at.name === 'name' || at.name.indexOf('hint-') === 0) { continue; }
        props[camel(at.name)] = interpVal(at.value, scope);
      }
      var inst = ctx.child(name, props);
      var s2 = Object.assign(Object.create(null), inst.renderVals() || {});
      renderNodes(def.tpl, s2, out, ctx);
      return;
    }
    if (tag === 'helmet') { return; }
    var el = node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      ? document.createElementNS(node.namespaceURI, node.tagName)
      : document.createElement(tag);
    for (var j = 0; j < node.attributes.length; j++) {
      var attr = node.attributes[j];
      var n = attr.name;
      if (n.length > 2 && n.slice(0, 2) === 'on' && attr.value.indexOf('{{') >= 0) {
        el.__h = el.__h || {};
        el.__h[n.slice(2).toLowerCase()] = interpVal(attr.value, scope);
        continue;
      }
      if (n.indexOf('hint-') === 0) { continue; }
      el.setAttribute(n, interpStr(attr.value, scope));
    }
    renderNodes(node.content ? node.content : node, scope, el, ctx);
    out.appendChild(el);
  }

  function bindEl(el) {
    if (!el.__h) { return; }
    el.__bound = el.__bound || {};
    Object.keys(el.__h).forEach(function (type) {
      if (el.__bound[type]) { return; }
      el.__bound[type] = true;
      el.addEventListener(type, function (e) {
        var f = el.__h && el.__h[type];
        if (typeof f === 'function') { f(e); }
      });
    });
  }
  function bindTree(root) {
    if (root.nodeType !== 1) { return; }
    bindEl(root);
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) { bindEl(all[i]); }
  }

  function same(a, b) {
    if (a.nodeType !== b.nodeType) { return false; }
    if (a.nodeType === 1) { return a.tagName === b.tagName && a.namespaceURI === b.namespaceURI; }
    return true;
  }
  function morphAttrs(live, next) {
    var i, at;
    for (i = live.attributes.length - 1; i >= 0; i--) {
      at = live.attributes[i];
      if (!next.hasAttribute(at.name)) { live.removeAttribute(at.name); }
    }
    for (i = 0; i < next.attributes.length; i++) {
      at = next.attributes[i];
      if (live.getAttribute(at.name) !== at.value) { live.setAttribute(at.name, at.value); }
    }
    live.__h = next.__h;
    bindEl(live);
  }
  function morphChildren(liveParent, nextParent) {
    var next = Array.prototype.slice.call(nextParent.childNodes);
    for (var i = 0; i < next.length; i++) {
      var n = next[i];
      var l = liveParent.childNodes[i];
      if (!l) { liveParent.appendChild(n); bindTree(n); continue; }
      if (same(l, n)) {
        if (n.nodeType === 1) { morphAttrs(l, n); morphChildren(l, n); }
        else if (l.nodeValue !== n.nodeValue) { l.nodeValue = n.nodeValue; }
      } else {
        liveParent.replaceChild(n, l);
        bindTree(n);
      }
    }
    while (liveParent.childNodes.length > next.length) { liveParent.removeChild(liveParent.lastChild); }
  }

  function mount(name, container) {
    var def = REG[name];
    var root = {};
    var inst = new def.Cls(defaultsOf(def));
    inst.state = inst.state || {};
    inst.__root = root;
    var kids = {};
    var ctx = {
      child: function (n, props) {
        var d = REG[n];
        var p = Object.assign(defaultsOf(d), props);
        if (!kids[n]) {
          var c = new d.Cls(p);
          c.state = c.state || {};
          c.__root = root;
          kids[n] = c;
        } else {
          kids[n].props = p;
        }
        return kids[n];
      }
    };
    var first = true, pending = false;
    root.render = function () {
      pending = false;
      var scope = Object.assign(Object.create(null), inst.renderVals() || {});
      var holder = document.createElement('div');
      renderNodes(def.tpl, scope, holder, ctx);
      if (first) {
        first = false;
        container.innerHTML = '';
        while (holder.firstChild) { container.appendChild(holder.firstChild); }
        bindTree(container);
      } else {
        morphChildren(container, holder);
      }
    };
    root.schedule = function () {
      if (pending) { return; }
      pending = true;
      Promise.resolve().then(root.render);
    };
    root.render();
    Object.keys(kids).forEach(function (k) { if (kids[k].componentDidMount) { kids[k].componentDidMount(); } });
    if (inst.componentDidMount) { inst.componentDidMount(); }
  }

  window.DC = {
    DCLogic: DCLogic,
    define: function (name, factory, propDefs) {
      var tplEl = document.getElementById('dc-tpl-' + name);
      REG[name] = { Cls: factory(DCLogic), propDefs: propDefs || {}, tpl: tplEl ? tplEl.content : document.createDocumentFragment() };
    },
    mount: mount
  };
})();
