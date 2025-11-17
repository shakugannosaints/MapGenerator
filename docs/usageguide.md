# Usage Guide

## Basic Usage

- Click `Generate` in the menu in the top right
- Drag and scroll to pan and zoom
- Open the `Style` folder to access styling options - Switch to `GoogleNoZoom` to see 3D buildings, or `Google` to see buildings when zoomed in
- You can turn 3D buildings on/off for any style with `buildingModels`
- When `zoomBuildings` is enabled, buildings are only shown when zoomed in

?> **Tip** Mac users and other users with high-DPI displays: 
Tick `highDPI` under the `options` folder to increase the resolution of the canvas. This will impact pan+zoom performance.

### Download City
You can download the city as a `.png`, `.svg`, `.stl`, or as a heightmap. The downloaded image will contain what's on screen, so if you're zoomed in, that's all that will be contained in the image.
Use `imageScale` to control the resolution of the downloaded `.png` - higher imageScale for higher resolution.

To download a heightmap, select the 'Heightmap' style from the Style folder, and download an image as usual.
See [Heightmap](heightmap.md) for more details.

## Performance

- The size of the generated world depends on your zoom + pan when you click generate
- The more zoomed in you are, the smaller the map and the faster it will generate
- 3D buildings slow down pan+zoom, but not generation time. If the FPS is too low, you can turn them on when you want them with the `buildingModels` option under `Style`

## Advanced Usage:

### Tensor Field

Cities are generated using  tensor field. If you open the `Tensor Field` folder you'll be able to view and edit it. You can add and remove grid elements. Use the red squares to drag them to different positions. Under the folder corresponding to each element, you can change its size and decay. You can also change the angle of the fields.

Click `setRecommended` in the tensor field folder to have the tool place 4 grids and one radial field in the scene. These have random parameters, so click multiple times until you find one you like.
Alternatively, add radial or grid fields manually. You can drag them to set their positions, and edit their parameters in the folders that appear.

!> **Important** The `generate` button in the top level of the menu randomises the tensor field. To work with your edited tensor field, you need to open the `Maps` folder and use the various generate buttons there.

### Maps

Open the `Maps` folder to start creating roads. You can click `generateEverything` or step through the process manually.

- **Water** - generate until you find a sea and river combination you like. Under the params folders, you can change the noise parameters to control how rough the shore and river bank are. The `simplifyTolerance` controls how closely the road follows the waterline.
- **Roads** - There are three road sizes: `main`, `major`, `minor`. Under each of the folders, you can click generate to create each class of roads individually. You can go back and edit the tensor field at any point in this process to create roads on different tensor fields. Experiment.
- **Buildings** - click `addBuildings` to fill the city with buildings. If you can't see them, the chosen style might not display buildings, or you might not be zoomed in enough. The `Default` style, and `GoogleNoZoom` styles both show buildings at all zoom levels. You can change the minimum building size, and the sidewalk size with `shrinkSpacing`.
- **Animation** - Generation will be faster if you untick 'Animate', but note that this will swamp the UI thread so you won't be able to pan, zoom, or retry until generation has completed. Animation speed gives you a tradeoff between FPS and generation time.

### New Controls

- **城市边界**: 在"城市边界"面板中控制城市生成的区域范围。
  - `启用边界`: 勾选后，道路、水系和建筑将只在自定义多边形区域内生成。
  - `编辑模式`: 勾选后可以编辑边界多边形：
    - **添加顶点**: 单击边界线附近添加新顶点。
    - **删除顶点**: 单击现有顶点（红点）删除它（至少保留3个顶点）。
    - **拖拽顶点**: 拖动红点调整多边形形状。
  - `重置边界`: 将边界重置为当前视图的默认矩形。
  - 边界在启用时显示为蓝色虚线，编辑模式下显示为红色实线并带有可拖拽的红点。
- **建筑密度**: In the `建筑` folder, adjust `建筑密度` (0–1) to control how many building lots are kept after subdivision. Lower values create sparser development.

**推荐工作流**:
1. 先在合适的缩放级别和位置生成一次城市，观察布局。
2. 打开"城市边界"文件夹，启用边界，进入编辑模式。
3. 通过点击和拖拽调整多边形，定义你想要的城市形状。
4. 退出编辑模式，重新生成水系、道路和建筑，它们将只出现在边界内。
5. 使用建筑密度滑块微调建筑物的稀疏程度。

## Recommended Workflow

Here are the steps I usually take when I use the tool:

- **Water First** - I open the `Map/Water` folder and click `Generate` until I'm happy with the water features.
- **Tensor Field Detail** - Opening the `Tensor` folder reveals the tensor field. I `addRadial` a couple of times to add some roundabouts. I `addGrid` a few times and change their size, decay, and position to vary the grid structure.
- **Roads** - I step through each of the `Main`, `Major`, `Minor` folders `Generate`ing roads at each stage, moving to the next when I'm happy. Increase `numParks` under `Map/Params` if you want more parks.
- **Buildings** - `Buildings/AddBuildings`

## Editing Colour Themes

The file containing the available colour schemes is [src/colour_schemes.json](https://github.com/ProbableTrain/MapGenerator/blob/master/src/colour_schemes.json). In future you'll be able to edit these in the web editor, but for now you have to build the project yourself to add colour schemes.
Edit this file to add a colour scheme, and it will automatically be included in the drop down menu. Currently, new colour schemes cannot have the hand-drawn look, but this will be changed in future.
