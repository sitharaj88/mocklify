/**
 * The running extension's version, set once at activation from the extension
 * manifest. Kept in a vscode-free module so services that stamp the version
 * into exports stay unit-testable.
 */
let extensionVersion = '0.0.0';

export function setExtensionVersion(version: string): void {
  if (version) {
    extensionVersion = version;
  }
}

export function getExtensionVersion(): string {
  return extensionVersion;
}
