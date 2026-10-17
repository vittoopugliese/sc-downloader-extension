const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class TestElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = {};
    this.className = "";
    this.id = "";
    this.style = {};
    this.textContent = "";
    this.classList = {
      add: (...names) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        names.forEach((name) => classes.add(name));
        this.className = [...classes].join(" ");
      },
      remove: (...names) => {
        const removed = new Set(names);
        this.className = this.className
          .split(/\s+/)
          .filter((name) => name && !removed.has(name))
          .join(" ");
      },
      contains: (name) => this.className.split(/\s+/).includes(name),
    };
  }

  appendChild(child) {
    child.parentElement?.removeChild(child);
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((candidate) => candidate !== child);
    child.parentElement = null;
  }

  insertBefore(child, reference) {
    child.parentElement?.removeChild(child);
    const index = this.children.indexOf(reference);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    child.parentElement = this;
    return child;
  }

  insertAdjacentElement(_position, child) {
    return this.appendChild(child);
  }

  querySelector(selector) {
    if (selector.startsWith("#")) {
      return findDescendant(this, (element) => element.id === selector.slice(1));
    }
    if (selector.startsWith(".")) {
      return findDescendant(this, (element) =>
        element.classList.contains(selector.slice(1))
      );
    }
    return null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener() {}

  remove() {
    this.parentElement?.removeChild(this);
  }
}

function findDescendant(root, predicate) {
  for (const child of root.children) {
    if (predicate(child)) return child;
    const nested = findDescendant(child, predicate);
    if (nested) return nested;
  }
  return null;
}

const body = new TestElement("body");
const head = new TestElement("head");
let profileButtonGroup = null;
let observerCallback = null;

const document = {
  body,
  head,
  createElement: (tagName) => new TestElement(tagName),
  getElementById(id) {
    return (
      findDescendant(head, (element) => element.id === id) ||
      findDescendant(body, (element) => element.id === id)
    );
  },
  querySelector(selector) {
    if (
      profileButtonGroup &&
      [
        ".userInfoBar__buttons .sc-button-group",
        ".userInfoBar__buttons",
      ].includes(selector)
    ) {
      return profileButtonGroup;
    }
    return null;
  },
};

const context = vm.createContext({
  console,
  URL,
  setTimeout,
  clearTimeout,
  document,
  window: {
    location: { origin: "https://soundcloud.com" },
    SCDL: {
      isTrackPage: () => false,
      isCollectionPage: () => true,
      isProfileTracksPage: () => true,
    },
  },
  globalThis: { SCDLI18n: { t: (key) => key }, SCIcons: { create(name, className) {
    const icon = document.createElement('sc-icon'); icon.setAttribute('name', name); icon.className = className; return icon;
  } } },
  chrome: {
    runtime: {
      getURL: (assetPath) => `chrome-extension://test/${assetPath}`,
    },
  },
  SCDownloadIntent: {
    create: () => ({}),
    isJobAlreadyRunning: () => false,
  },
  SCDownloadTrack: { canDownload: () => false },
  SCStreamSelector: {},
  MutationObserver: class {
    constructor(callback) {
      observerCallback = callback;
    }
    observe() {}
  },
});

const inlineButtonPath = path.resolve(__dirname, "inline-button.js");
vm.runInContext(fs.readFileSync(inlineButtonPath, "utf8"), context, {
  filename: inlineButtonPath,
});

vm.runInContext("ensureInlineDownloadButton()", context);
assert.equal(
  document.getElementById("scdl-inline-download"),
  null,
  "The profile button must wait for the header action group instead of floating"
);

profileButtonGroup = new TestElement("div");
profileButtonGroup.className = "sc-button-group";
body.appendChild(profileButtonGroup);
observerCallback();

const button = document.getElementById("scdl-inline-download");
assert.ok(button, "The profile button should mount when the header group appears");
assert.equal(button.parentElement, profileButtonGroup);
assert.equal(body.children.includes(button), false);
assert.equal(button.classList.contains("scdl-profile-floating"), false);
assert.match(
  head.querySelector("#scdl-inline-styles").textContent,
  /scdl-profile-download[\s\S]*background:\s*#f50/,
  "The header profile button should use the orange treatment"
);

console.log("Inline profile button verification passed.");
