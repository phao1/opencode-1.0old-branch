import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('Mac launcher removes only the initial OSC 11 query across arbitrary stream boundaries', { skip: process.platform !== 'darwin' }, () => {
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/mac-native-launcher.c')
  const dir = mkdtempSync(path.join(tmpdir(), 'mac-launcher-contract-'))
  try {
    const file = path.join(dir, 'contract.c'), binary = path.join(dir, 'contract')
    writeFileSync(file, `#define main launcher_main
#include ${JSON.stringify(source)}
#undef main
#include <assert.h>
int main(void) {
  const unsigned char input[] = "before\\033]11;?\\007after\\033]11;?\\007later";
  const unsigned char expected[] = "beforeafter\\033]11;?\\007later";
  unsigned char out[256]; size_t len = sizeof(input)-1;
  for (size_t cut=0; cut<=len; ++cut) {
    struct probe_filter f={0};
    size_t n=filter_probe(&f,input,cut,out);
    n+=filter_probe(&f,input+cut,len-cut,out+n);
    assert(n==sizeof(expected)-1 && !memcmp(out,expected,n) && f.suppressed);
  }
  struct probe_filter f={0}; size_t n=0;
  for(size_t i=0;i<len;++i)n+=filter_probe(&f,input+i,1,out+n);
  assert(n==sizeof(expected)-1 && !memcmp(out,expected,n));
  puts("all stream partitions passed"); return 0;
}
`)
    execFileSync('clang', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', file, '-o', binary])
    assert.match(execFileSync(binary, { encoding: 'utf8' }), /all stream partitions passed/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
