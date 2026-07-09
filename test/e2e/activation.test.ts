import * as assert from 'node:assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'sitharaj.mocklify';

suite('Activation', () => {
  test('the extension is present and activates', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} should be installed in the test host`);
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true, 'Extension should be active');
  });

  test('every command declared in package.json is registered', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)!;
    await ext.activate();

    const declared: string[] = (
      ext.packageJSON?.contributes?.commands ?? []
    ).map((c: { command: string }) => c.command);
    assert.ok(declared.length > 0, 'package.json should declare commands');

    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = declared.filter((id) => !registered.has(id));
    assert.deepStrictEqual(
      missing,
      [],
      `These declared commands were not registered: ${missing.join(', ')}`
    );
  });
});
