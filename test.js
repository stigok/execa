import path from 'path';
import stream from 'stream';
import childProcess from 'child_process';
import test from 'ava';
import getStream from 'get-stream';
import isRunning from 'is-running';
import delay from 'delay';
import m from './';

process.env.PATH = path.join(__dirname, 'fixtures') + path.delimiter + process.env.PATH;

test('execa()', async t => {
	const {stdout} = await m('noop', ['foo']);
	t.is(stdout, 'foo');
});

test('buffer', async t => {
	const {stdout} = await m('noop', ['foo'], {encoding: null});
	t.true(Buffer.isBuffer(stdout));
	t.is(stdout.toString(), 'foo');
});

test('execa.stdout()', async t => {
	const stdout = await m.stdout('noop', ['foo']);
	t.is(stdout, 'foo');
});

test('execa.stderr()', async t => {
	const stderr = await m.stderr('noop-err', ['foo']);
	t.is(stderr, 'foo');
});

test('stdout/stderr available on errors', async t => {
	const err = await t.throws(m('exit', ['2']));
	t.is(typeof err.stdout, 'string');
	t.is(typeof err.stderr, 'string');
});

test('include stdout and stderr in errors for improved debugging', async t => {
	const err = await t.throws(m('fixtures/error-message.js'));
	t.regex(err.message, /stdout/);
	t.regex(err.message, /stderr/);
});

test('execa.shell()', async t => {
	const {stdout} = await m.shell('node fixtures/noop foo');
	t.is(stdout, 'foo');
});

test('execa.spawn()', async t => {
	t.is(typeof m.spawn('noop').pid, 'number');
	t.is((await getStream(m.spawn('noop', ['foo']).stdout)).trim(), 'foo');
});

test('execa.sync()', t => {
	const {stdout} = m.sync('noop', ['foo']);
	t.is(stdout, 'foo');
});

test('execa.shellSync()', t => {
	const {stdout} = m.shellSync('node fixtures/noop foo');
	t.is(stdout, 'foo');
});

test('stripEof option', async t => {
	const {stdout} = await m('noop', ['foo'], {stripEof: false});
	t.is(stdout, 'foo\n');
});

test.serial('preferLocal option', async t => {
	t.true((await m('cat-names')).stdout.length > 2);

	if (process.platform === 'win32') {
		// TODO: figure out how to make the below not hang on Windows
		return;
	}

	// account for npm adding local binaries to the PATH
	const _path = process.env.PATH;
	process.env.PATH = '';
	await t.throws(m('cat-names', {preferLocal: false}), /spawn .* ENOENT/);
	process.env.PATH = _path;
});

test('input option can be a String', async t => {
	const {stdout} = await m('stdin', {input: 'foobar'});
	t.is(stdout, 'foobar');
});

test('input option can be a Buffer', async t => {
	const {stdout} = await m('stdin', {input: 'testing12'});
	t.is(stdout, 'testing12');
});

test('input can be a Stream', async t => {
	const s = new stream.PassThrough();
	s.write('howdy');
	s.end();
	const {stdout} = await m('stdin', {input: s});
	t.is(stdout, 'howdy');
});

test('you can write to child.stdin', async t => {
	const child = m('stdin');
	child.stdin.end('unicorns');
	t.is((await child).stdout, 'unicorns');
});

test('input option can be a String - sync', async t => {
	const {stdout} = m.sync('stdin', {input: 'foobar'});
	t.is(stdout, 'foobar');
});

test('input option can be a Buffer - sync', async t => {
	const {stdout} = m.sync('stdin', {input: new Buffer('testing12', 'utf8')});
	t.is(stdout, 'testing12');
});

test('opts.stdout:ignore - stdout will not collect data', async t => {
	const {stdout} = await m('stdin', {
		input: 'hello',
		stdio: [null, 'ignore', null]
	});
	t.is(stdout, null);
});

test('helpful error trying to provide an input stream in sync mode', t => {
	t.throws(
		() => m.sync('stdin', {input: new stream.PassThrough()}),
		/The `input` option cannot be a stream in sync mode/
	);
});

test('execa() returns a promise with kill() and pid', t => {
	const promise = m('noop', ['foo']);
	t.is(typeof promise.kill, 'function');
	t.is(typeof promise.pid, 'number');
});

test('maxBuffer affects stdout', t => {
	t.throws(m('max-buffer', ['stdout', '11'], {maxBuffer: 10}), /stdout maxBuffer exceeded/);
	t.notThrows(m('max-buffer', ['stdout', '10'], {maxBuffer: 10}));
});

test('maxBuffer affects stderr', t => {
	t.throws(m('max-buffer', ['stderr', '13'], {maxBuffer: 12}), /stderr maxBuffer exceeded/);
	t.notThrows(m('max-buffer', ['stderr', '12'], {maxBuffer: 12}));
});

test('skip throwing when using reject option', async t => {
	const err = await t.notThrows(m('exit', ['2'], {reject: false}));
	t.is(typeof err.stdout, 'string');
	t.is(typeof err.stderr, 'string');
});

test('execa() returns code and failed properties', async t => {
	const {code, failed} = await m('noop', ['foo']);
	const err = await t.throws(m('exit', ['2']));
	t.is(code, 0);
	t.false(failed);
	t.is(err.code, 2);
	t.true(err.failed);
});

test(`use relative path with '..' chars`, async t => {
	const pathViaParentDir = path.join('..', path.basename(__dirname), 'fixtures', 'noop');
	const {stdout} = await m(pathViaParentDir, ['foo']);
	t.is(stdout, 'foo');
});

if (process.platform !== 'win32') {
	test('execa() rejects if running non-executable', t => {
		const cp = m('non-executable');
		t.throws(cp);
	});
}

test('err.killed is true if process was killed directly', async t => {
	const cp = m('forever');

	setTimeout(() => {
		cp.kill();
	}, 100);

	const err = await t.throws(cp);

	t.true(err.killed);
});

// TODO: Should this really be the case, or should we improve on child_process?
test('err.killed is false if process was killed indirectly', async t => {
	const cp = m('forever');

	setTimeout(() => {
		process.kill(cp.pid, 'SIGINT');
	}, 100);

	const err = await t.throws(cp);

	t.false(err.killed);
});

if (process.platform === 'darwin') {
	test.cb('sanity check: child_process.exec also has killed.false if killed indirectly', t => {
		const cp = childProcess.exec('forever', err => {
			t.truthy(err);
			t.false(err.killed);
			t.end();
		});

		setTimeout(() => {
			process.kill(cp.pid, 'SIGINT');
		}, 100);
	});
}

if (process.platform !== 'win32') {
	test('err.signal is SIGINT', async t => {
		const cp = m('forever');

		setTimeout(() => {
			process.kill(cp.pid, 'SIGINT');
		}, 100);

		const err = await t.throws(cp);

		t.is(err.signal, 'SIGINT');
	});

	test('err.signal is SIGTERM', async t => {
		const cp = m('forever');

		setTimeout(() => {
			process.kill(cp.pid, 'SIGTERM');
		}, 100);

		const err = await t.throws(cp);

		t.is(err.signal, 'SIGTERM');
	});
}

test('result.signal is null for successful execution', async t => {
	t.is((await m('noop')).signal, null);
});

test('result.signal is null if process failed, but was not killed', async t => {
	const err = await t.throws(m('exit', [2]));
	t.is(err.signal, null);
});

async function code(t, num) {
	const err = await t.throws(m('exit', [`${num}`]));

	t.is(err.code, num);
}

test('err.code is 2', code, 2);
test('err.code is 3', code, 3);
test('err.code is 4', code, 4);

async function errorMessage(t, expected, ...args) {
	const err = await t.throws(m('exit', args));

	t.regex(err.message, expected);
}

errorMessage.title = (message, expected) => `err.message matches: ${expected}`;

test(errorMessage, /Command failed: exit 2 foo bar/, 2, 'foo', 'bar');
test(errorMessage, /Command failed: exit 3 baz quz/, 3, 'baz', 'quz');

async function cmd(t, expected, ...args) {
	const err = await t.throws(m('fail', args));

	t.is(err.cmd, `fail${expected}`);

	const result = await m('noop', args);

	t.is(result.cmd, `noop${expected}`);
}

cmd.title = (message, expected) => `cmd is: ${JSON.stringify(expected)}`;

test(cmd, ' foo bar', 'foo', 'bar');
test(cmd, ' baz quz', 'baz', 'quz');
test(cmd, '');

async function spawnAndKill(t, signal, cleanup) {
	const name = cleanup ? 'sub-process' : 'sub-process-false';
	const cp = m(name);
	let pid;

	cp.stdout.setEncoding('utf8');
	cp.stdout.on('data', chunk => {
		pid = parseInt(chunk, 10);
		t.is(typeof pid, 'number');

		setTimeout(() => {
			process.kill(cp.pid, signal);
		}, 100);
	});

	await t.throws(cp);

	// Give everybody some time to breath and kill things
	await delay(200);

	t.false(isRunning(cp.pid));
	t.is(isRunning(pid), !cleanup);
}

test('cleanup - SIGINT', spawnAndKill, 'SIGINT', true);
test('cleanup - SIGKILL', spawnAndKill, 'SIGTERM', true);

if (process.platform !== 'win32') {
	// On Windows the subprocesses are actually always killed
	test('cleanup false - SIGINT', spawnAndKill, 'SIGTERM', false);
	test('cleanup false - SIGKILL', spawnAndKill, 'SIGKILL', false);
}

// see: https://github.com/sindresorhus/execa/issues/56
const onlyWinFailing = test[process.platform === 'win32' ? 'failing' : 'serial'];
onlyWinFailing('execa.shell() supports the `shell` option', async t => {
	const {stdout} = await m.shell('noop foo', {
		shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'
	});
	t.is(stdout, 'foo');
});
