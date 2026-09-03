import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/test/**/*.test.ts'],
    environment: 'node',
    // どのテストも three.js に触らない純粋なロジックなので、ファイルごとにワーカーを
    // 隔離してモジュールを読み直す意味がない。切るとインポートが 7.3s から 2.8s に落ち、
    // スイート全体が半分の時間で終わる。分離が要る調査をしたいときは `vitest run --isolate`。
    isolate: false,
    // 地形生成のテストはスーパーチャンクを組む。1 枚 300ms 前後で、川の場を作るには
    // 周囲 8 枚も要るので、既定の 5 秒では素通しできない。ここに引っかかるほど遅い
    // テストは生成以外にはないはずなので、遅くなったら疑うべきはキャッシュの枚数。
    testTimeout: 60000,
  },
});
