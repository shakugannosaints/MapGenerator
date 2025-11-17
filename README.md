# 这是此项目的中文改进版

为个人跑团活动fork并部署，不承诺处理任何使用中遇到的问题。

以下为该fork版本中实现的新功能与特性：

## 建筑密度

在地图-建筑菜单中可控制。

## 城市生成范围

在地图-城市边界菜单中可开启与编辑。

## 自动染色

在样式-用地类型染色中可开启与编辑参数。

## 道路网络真实性增强

为了让生成的城市更像真实城市,新增了**真实性增强系统**,可以让道路产生自然的弯曲,模拟历史发展、地形影响等因素。

### 核心功能:
- **路径扰动**: 让笔直的道路产生自然弯曲
- **地形影响**: 道路会避开虚拟的"山地",沿着平缓路径
- **历史分层**: 中心老城区道路曲折,外围新城区道路规整
- **方向偏好**: 模拟历史遗迹(城墙、河流等)对道路布局的影响

### 预设配置:
- 默认(现代): 轻微扰动的现代城市
- 老城区: 高度不规则的历史街区
- 混合城市: 从老城到新城的发展过程
- 地形适应: 山地/丘陵地形城市

### 💡 统一设置面板(推荐):
在"道路"菜单下的"真实性增强(统一设置)"面板中:
- ✅ 一键应用预设到所有道路层级
- ✅ 统一调整参数后点击"应用"
- ✅ 也可在各道路子菜单中单独设置
---

以下为原项目readme.md全文翻译。

<!-- ALL-CONTRIBUTORS-BADGE:START - 请勿移除或修改此部分 -->
[![所有贡献者](https://img.shields.io/badge/all_contributors-4-orange.svg?style=flat-square)](#contributors-)
<!-- ALL-CONTRIBUTORS-BADGE:END -->

<br />
<p align="center">
  <a href="https://github.com/probabletrain/mapgenerator">
      <img src="docs/images/logo.png" alt="Logo" width="125" height="125">
  </a>

  <h3 align="center">地图生成器</h3>

  <p align="center">
    创建程序化生成的美式风格城市
    <br />
    <a href="https://probabletrain.itch.io/city-generator"><strong>打开生成器 »</strong></a>
    <br />
    <br />
    <a href="https://maps.probabletrain.com" target="_blank">阅读文档</a>
    ·
    <a href="https://github.com/probabletrain/mapgenerator/issues">报告错误</a>
    ·
    <a href="https://github.com/probabletrain/mapgenerator/issues">请求功能</a>
  </p>
</p>


## 目录

* [关于项目](#关于项目)
  * [构建工具](#构建工具)
* [快速开始](#快速开始)
  * [前置要求](#前置要求)
  * [安装](#安装)
* [使用方法](#使用方法)
* [开发路线](#开发路线)
* [参与贡献](#参与贡献)
* [许可证](#许可证)
* [联系方式](#联系方式)



## 关于项目

![地图生成器截图](docs/images/screenshot.png)
<!-- TODO YT 视频 -->

此工具可程序化生成城市地图图像。该过程可以自动化，也可以在每一步进行控制，让您能更精细地控制输出结果。
生成的城市的 3D 模型可以以 `.stl` 格式下载。下载内容是一个 `zip` 压缩包，包含地图不同组件的多个 `.stl` 文件。
生成的城市图像可以以 `.png` 或 `.svg` 格式下载。有多种绘制风格可选，范围从类似谷歌或苹果地图的色彩主题，到手绘草图风格。


### 构建工具

* [Typescript](https://www.typescriptlang.org/)
* [Gulp](https://gulpjs.com/)


## 快速开始

请按照以下步骤在本地运行此项目。

### 前置要求


* npm
```sh
npm install npm@latest -g
```

* Gulp
```
npm install --global gulp-cli
```

### 安装

1. 克隆地图生成器仓库
```sh
git clone https://github.com/probabletrain/mapgenerator.git
```
2. 安装 NPM 包
```sh
cd mapgenerator
npm install
```
3. 使用 Gulp 构建。这将监视任何 Typescript 文件的更改。如果您编辑了 HTML 或 CSS 文件，则需要重新运行此命令。[Gulp Notify](https://github.com/mikaelbr/gulp-notify) 会在每次构建完成时发送通知。
```
gulp
```
4. 在网页浏览器中打开 `dist/index.html`，每当项目重新构建后刷新页面即可。

## GitHub Pages 部署

本项目是纯前端静态生成（通过 Gulp + Browserify 将所有 `src/**/*.ts` 打包到 `dist/bundle.js`，并复制 `src/html/index.html` 与 `style.css`），因此可以直接使用 GitHub Pages 部署。

### 自动化部署（GitHub Actions）
已包含一个工作流文件：`.github/workflows/deploy.yml`，它会在推送到 `master` 分支时：

1. 安装依赖 (`npm ci`)
2. 执行构建 (`npm run build` 生成 `dist/` 目录)
3. 通过官方 Pages Action 上传并发布 `dist` 目录为站点内容

部署完成后，可在仓库的 Settings -> Pages 中查看站点 URL。

### 手动部署
如果想手动部署，可在本地执行：
```bash
npm install
npm run build
```
然后将 `dist` 目录的内容推送到一个名为 `gh-pages` 的分支根目录，或复制到仓库根下的 `docs/` 目录并在 Settings 中选择 `docs/` 作为 Pages 来源。

### 注意事项
* 如果新增或修改了 TS/HTML/CSS 文件，重新运行 `npm run build` 即可。
* 工作流使用 `npm ci`，请勿手动修改 `node_modules` 后提交；依赖变更请更新 `package.json` 并提交。
* 构建过程中会执行 gulp 里的 `apply-babelify-patch` 以兼容某些依赖的 browserify 转换。



## 使用方法

请参阅 [文档](https://maps.probabletrain.com)。




## 开发路线

请参阅 [待解决问题](https://github.com/probabletrain/mapgenerator/issues) 以获取提议功能（和已知问题）的列表。




## 参与贡献

贡献使开源社区成为学习、激励和创造的绝佳场所。您所做的任何贡献都**非常值得赞赏**。对于重大更改，请先提出问题以讨论您希望更改的内容。

1. Fork 本项目
2. 创建您的功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交您的更改 (`git commit -m '添加了一些 AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启一个 Pull Request

## 贡献者 ✨

感谢这些优秀的人 ([表情符号说明](https://allcontributors.org/docs/en/emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - 请勿移除或修改此部分 -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tr>
    <td align="center"><a href="https://github.com/trees-and-airlines"><img src="https://avatars3.githubusercontent.com/u/63573826?v=4" width="100px;" alt=""/><br /><sub><b>trees-and-airlines</b></sub></a><br /><a href="#infra-trees-and-airlines" title="基础设施（托管、构建工具等）">🚇</a></td>
    <td align="center"><a href="https://github.com/ProbableTrain"><img src="https://avatars2.githubusercontent.com/u/33726340?v=4" width="100px;" alt=""/><br /><sub><b>Keir</b></sub></a><br /><a href="https://github.com/ProbableTrain/MapGenerator/commits?author=ProbableTrain" title="代码">💻</a></td>
    <td align="center"><a href="https://github.com/ersagunkuruca"><img src="https://avatars3.githubusercontent.com/u/8115002?v=4" width="100px;" alt=""/><br /><sub><b>Ersagun Kuruca</b></sub></a><br /><a href="https://github.com/ProbableTrain/MapGenerator/commits?author=ersagunkuruca" title="代码">💻</a></td>
    <td align="center"><a href="https://github.com/Jason-Patrick"><img src="https://avatars3.githubusercontent.com/u/65310110?v=4" width="100px;" alt=""/><br /><sub><b>Jason-Patrick</b></sub></a><br /><a href="https://github.com/ProbableTrain/MapGenerator/commits?author=Jason-Patrick" title="代码">💻</a></td>
  </tr>
</table>

<!-- markdownlint-enable -->
<!-- prettier-ignore-end -->
<!-- ALL-CONTRIBUTORS-LIST:END -->

本项目遵循 [all-contributors](https://github.com/all-contributors/all-contributors) 规范。欢迎任何类型的贡献！


## 联系方式

Keir - [@probabletrain](https://twitter.com/probabletrain) - probabletrain@gmail.com

项目链接：[https://github.com/probabletrain/mapgenerator](https://github.com/probabletrain/mapgenerator)



## 许可证

基于 LGPL-3.0 许可证分发。有关更多信息，请参阅 `COPYING` 和 `COPYING.LESSER` 文件。

```
