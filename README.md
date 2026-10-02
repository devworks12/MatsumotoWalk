# MATSUMOTO FOOD WALK

**松本駅から、おいしい場所へ。** — *Explore Matsumoto through food.*

松本駅周辺を「高級建築模型 × ダークモダンUI × ミニチュア都市」として 3D で探索しながら、食べたいお店を見つけ、松本駅からお店までの道のりを 3D で体験する Web サイトです。

- 3D 都市（Three.js / WebGL2）：松本駅・駅前広場・本町・中町・縄手通り・女鳥羽川・松本城・北アルプスの遠景
- 41 店舗の静的データ（信州そば / 山賊焼 / ラーメン / 洋食 / 和食 / 焼肉 / 居酒屋 / カフェ / スイーツ / ベーカリー）
- 独自の道路グラフと **A\*** によるオフライン経路探索（WALK / BIKE / CAR × FASTEST / EASY / SCENIC）
- 信号待ち・大通り横断・右左折・駐車・自転車の準備時間を考慮した所要時間、ルールベースの BEST CHOICE
- 発光ルートラインの描画アニメーション、Ease In/Out のカメラ遷移、POV ルートプレビュー（交差点で減速 → 直線で加速 → 到着前に減速）、到着演出
- 時間帯：朝焼け / 昼 / 夕焼け / 夜、または松本の現在時刻に自動で合わせる（太陽の位置・空・霧・影がゆっくり変化。夜は窓・店先・街灯・車のライトが暖色に発光）
- 天気：晴れ / 雨（濡れた路面、雨の線、雨音）/ 雪（屋根や道に積もる雪、舞う雪）
- スマートフォン最優先の Floating UI（Bottom Sheet / 横画面サイドパネル / PC フローティングカード）
- 検索・カテゴリフィルター・EXPLORE（時間帯に合わせたおすすめ）・環境音（初期 OFF）
- **外部 API なし**：地図・経路・店舗情報はすべてリポジトリ内の静的ファイルです。ビルド不要。

> 掲載店舗はすべて**架空のサンプルデータ**です。街並み・道路は松本駅周辺の構成を参考にした抽象的なモデルで、正確な地図ではありません。所要時間は「体感として自然」な目安です。

---

## 起動方法

ES Modules と import map だけで動くため、**ビルドもパッケージのインストールも不要**です。静的ファイルを配信できるサーバーなら何でも動きます（`file://` で直接開くと `fetch` が使えないため、必ずサーバー経由で開いてください）。

```bash
# Node.js 18+（依存パッケージなし）
npm run dev            # = node scripts/serve.mjs 5173
# → http://localhost:5173/
#   同じ Wi-Fi のスマートフォンからは表示される http://192.168.x.x:5173/ で確認できます

# Python でも可
python3 -m http.server 8000
```

URL の末尾に `#r021` のように店舗 ID を付けると、その店舗を選択した状態で開きます。

### 操作

| | PC | スマートフォン |
|---|---|---|
| 回転 | ドラッグ | 1 本指ドラッグ |
| ズーム | ホイール | 2 本指ピンチ |
| 移動 | 右ドラッグ | 2 本指ドラッグ |
| 選択 | クリック | タップ |
| その他 | `/` 検索、`Esc` 戻る、マップにフォーカスして矢印キー / `+` `-` | シートを上下にスワイプ |

## ビルド方法

配信用のビルド工程はありません。リポジトリの内容をそのまま公開できます。

データを編集したときだけ、次を実行します。

```bash
npm run data     # 道路グラフ・建物・店舗位置を再生成（scripts/generate-data.mjs）
npm run check    # 全店舗 × 3 移動手段 × 3 ルートを計算して検証（scripts/check.mjs）
npm run build    # 上の 2 つを続けて実行
```

生成は乱数シード固定なので、何度実行しても同じ結果になります。

## ファイル構成

```
index.html               画面の骨組み（UI の DOM、import map、ローディング）
styles/main.css          UI デザイン（ダークモダン / 100dvh / safe-area / 横画面 / reduced-motion）
src/
  main.js                アプリ本体：初期化・入力・選択・ルート表示・ツアー・検索・EXPLORE
  scene.js               Renderer / カメラ / ライト / 空 / Bloom / 動的解像度
  atmosphere.js          時間帯（時刻ごとのキーフレーム、太陽の軌道）と天気による光・空・霧の制御
  weather.js             雨と雪のパーティクル（カメラに追従、計算は GPU）
  city.js                地面・道路・横断歩道・川と橋・線路・建物（InstancedMesh）・松本駅・松本城（大天守・乾小天守・辰巳附櫓・月見櫓・埋橋、夜のライトアップ）・北アルプス（常念岳・槍・穂高・乗鞍・美ヶ原の方角に合わせた山並み）
  props.js               街路樹・街灯（夜の光だまり）・信号・ベンチ・店舗の看板とひさし
  streetlife.js          地上目線のディテール：蔵・町家の庇とのれん、自販機、プランター、駐輪、立て看板、電柱と電線、縄手のカエル像と鳥居、中町の提灯
  traffic.js             車・歩行者・電車（ミニチュアの街の動き）
  restaurants.js         店舗ビーコン（浮遊リング + アイコン）、店名ラベル、選択エフェクト、タップ判定
  routing.js             道路グラフ・A* 探索・所要時間モデル・ルート候補・BEST 推奨
  pathgeo.js             ルートを歩道 / 車線位置へオフセットし、角を丸めて等間隔サンプリング
  routeLine.js           発光ルートライン（シェーダー、伸びるアニメーション、光の粒）
  cameraTour.js          カメラ遷移（球面補間 + イージング）、オープニング、POV ツアー
  ui.js                  UI 描画とイベント（Bottom Sheet のスワイプ、タブ、検索、設定…）
  materials.js           建物シェーダー（窓・蔵のなまこ壁・夜景）、水面、空、山、共通 uniform
  icons.js               ラインアイコン（UI と 3D ビーコンのテクスチャアトラスで共用）
  audio.js               環境音（WebAudio で生成。音声ファイルなし）
  fallback2d.js          WebGL2 非対応端末向けの簡易 2D 表示（同じ経路探索を使用）
  config.js              カテゴリ・フィルター・移動手段の速度 / ペナルティ・パレット
  util.js                共通関数（イージング、営業時間判定、書式など）
data/
  restaurants.json       店舗データ
  roads.json             道路グラフ（生成物）
  buildings.json         建物配置（生成物）
assets/
  food/*.svg             ジャンル別のオリジナル料理イラスト（統一デザイン）
  icons/favicon.svg
scripts/
  generate-data.mjs      道路・建物データ生成スクリプト（道路の定義はここ）
  check.mjs              データと経路の検証
  serve.mjs              開発用の静的サーバー（依存なし）
vendor/three/            Three.js r170（MIT）と使用するアドオンのみ同梱
.github/workflows/pages.yml  GitHub Pages への自動デプロイ
```

3D モデルやテクスチャ画像のファイルはありません。建物・駅・城・山並み・窓の光などはすべてコードとシェーダーで生成しています（初期ロードが軽く、データは約 0.3 MB）。

### 座標系

単位はメートル。原点は **松本駅お城口（東口）**、`+x` が東、`+z` が南（北は `-z`）です。

## 店舗追加方法

1. `data/restaurants.json` の `restaurants` 配列に追加します。

   ```json
   {
     "id": "r042",
     "name": "店舗名",
     "category": "soba",
     "position": { "x": 600, "z": -300 },
     "priceLevel": 2,
     "priceText": "¥1,000〜2,000",
     "tags": ["松本名物", "一人でも入りやすい"],
     "menu": ["ざるそば", "天ざる"],
     "description": "店舗の短い説明。",
     "hours": [["11:00", "15:00"], ["17:00", "21:00"]],
     "closed": [3]
   }
   ```

   | 項目 | 内容 |
   |---|---|
   | `category` | `soba` `sanzoku` `ramen` `yoshoku` `washoku` `yakiniku` `izakaya` `cafe` `sweets` `bakery`（`src/config.js` の `CATEGORIES`） |
   | `position` | おおよその位置でかまいません。生成時に最寄りの道路の歩道へ自動で補正されます |
   | `priceLevel` | 1〜3 |
   | `hours` | `[開店, 閉店]` の配列。深夜 0 時閉店は `"24:00"` |
   | `closed` | 定休日（0 = 日曜 … 6 = 土曜） |
   | `tags` | `松本名物` は LOCAL フィルター、`朝から営業` は EXPLORE の朝の候補に使われます |

2. `npm run build` を実行します。位置が道路沿いに補正され、店舗用の建物（Level B）が生成され、全ルートが検証されます。
3. ブラウザを再読み込みすれば反映されます。

新しいジャンルを足す場合は `src/config.js` の `CATEGORIES`（検索用の別名も）と `FILTERS`、`src/icons.js` の `ICONS` / `CATEGORY_ORDER`、`assets/food/<category>.svg` を追加します。

## 道路データ追加方法

道路は `scripts/generate-data.mjs` の `STREETS` 配列で定義しています。折れ線の座標を書くだけで、交差点の検出・ノード / エッジの生成・建物の再配置は自動で行われます。

```js
{ id: 'new-street', name: '新しい通り', type: 'street', pts: [[300, -100], [300, -400]], scenic: 0.4 },
```

| 項目 | 内容 |
|---|---|
| `type` | `avenue`（大通り）`street` `lane`（細街路）`shotengai`（商店街）`pedestrian`（歩行者専用）`plaza` `passage`（駅自由通路など徒歩のみ） |
| `scenic` | 0〜1。街歩きの楽しさ。SCENIC ルートの評価に使います |
| `oneway: true` | 車は `pts` の向きにのみ通行可（徒歩・自転車は双方向） |

道路タイプごとの幅・歩道幅・通行可能な移動手段は同ファイルの `ROAD_TYPES`、速度と信号・右左折・駐車のペナルティは `src/config.js` の `MODES` で調整できます。交差点の信号は「主要道路（avenue / street）が 2 本以上交わる交差点」に自動で設定されます。

編集後は `npm run build` を実行してください。

## GitHub Pages 公開方法

`.github/workflows/pages.yml` が `main` ブランチへの push のたびに検証（`scripts/check.mjs`）とデプロイを行います。

1. GitHub のリポジトリで **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にします（初回のみ）。
2. `main` に push します（または **Actions → Deploy to GitHub Pages → Run workflow**）。
3. `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます。

すべて相対パスで参照しているので、サブディレクトリでも、Netlify / Cloudflare Pages / 任意の静的ホスティングでもそのまま動きます。Actions を使わない場合は、Source を **Deploy from a branch**（`main` / root）にしても動作します（`.nojekyll` 同梱）。

## パフォーマンスと互換性

- 目標：iPhone 15 / 16 世代の Safari で 30〜60 fps
- 背景の建物はすべて InstancedMesh（建物 5,000 棟以上を数回の描画で）、道路はジオメトリ結合、街路樹・街灯・人・車もインスタンス化
- 影は太陽光 1 灯のみ・静的（昼夜切替時などにだけ再計算）、動く物は影を落とさない。地面には建物の柔らかい接地影をあらかじめ焼き込み
- `devicePixelRatio` は最大 2（PC は 1.75）、フレームレートを監視して自動で解像度を下げ、必要なら Bloom も停止（設定で AUTO / HIGH / LOW）
- Bloom は半解像度、控えめな強さ。Chromatic Aberration / Vignette / Film Grain は不使用
- `100dvh`・`env(safe-area-inset-*)`・縦横の回転・ブラウザバーの伸縮に対応
- `prefers-reduced-motion`（または設定の「控えめ」）では POV の移動演出を省略し、到着地点へ直接切り替え
- WebGL2 が使えない場合は簡易 2D マップ（同じ経路探索・推奨ロジック）を表示
- 対応ブラウザ：Safari 16.4+ / Chrome / Edge / Firefox の最新版（import map 必須）

## ライセンス

- このプロジェクトのコード・データ・イラスト：MIT
- Three.js（`vendor/three/`）：MIT © three.js authors（`vendor/three/LICENSE`）
