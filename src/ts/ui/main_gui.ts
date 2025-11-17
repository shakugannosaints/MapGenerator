import * as log from 'loglevel';
import DomainController from './domain_controller';
import DragController from './drag_controller';
import TensorField from '../impl/tensor_field';
import {RK4Integrator} from '../impl/integrator';
import FieldIntegrator from '../impl/integrator';
import {StreamlineParams} from '../impl/streamlines';
import {WaterParams} from '../impl/water_generator';
import Graph from '../impl/graph';
import RoadGUI from './road_gui';
import WaterGUI from './water_gui';
import Vector from '../vector';
import PolygonFinder from '../impl/polygon_finder';
import {PolygonParams} from '../impl/polygon_finder';
import StreamlineGenerator from '../impl/streamlines';
import WaterGenerator from '../impl/water_generator';
import Style from './style';
import {DefaultStyle, RoughStyle} from './style';
import CanvasWrapper, {DefaultCanvasWrapper} from './canvas_wrapper';
import Buildings, {BuildingModel} from './buildings';
import PolygonUtil from '../impl/polygon_util';
import CityBoundary from './city_boundary';
import Util from '../util';

/**
 * Handles Map folder, glues together impl
 */
export default class MainGUI {
    private numBigParks: number = 2;
    private numSmallParks: number = 0;
    private clusterBigParks: boolean = false;

    private domainController = DomainController.getInstance();
    private intersections: Vector[] = [];
    private bigParks: Vector[][] = [];
    private smallParks: Vector[][] = [];
    private animate: boolean = true;
    private animationSpeed: number = 30;

    private coastline: WaterGUI;
    private mainRoads: RoadGUI;
    private majorRoads: RoadGUI;
    private minorRoads: RoadGUI;
    public buildings: Buildings;  // 改为 public 以便从 Main 访问
    
    // 城市边界
    private cityBoundary: CityBoundary;

    // Params
    private coastlineParams: WaterParams;
    private mainParams: StreamlineParams;
    private majorParams: StreamlineParams;
    private minorParams: StreamlineParams = {
        dsep: 20,
        dtest: 15,
        dstep: 1,
        dlookahead: 40,
        dcirclejoin: 5,
        joinangle: 0.1,  // approx 30deg
        pathIterations: 1000,
        seedTries: 300,
        simplifyTolerance: 0.5,
        collideEarly: 0,
        
        // 真实性增强参数默认值
        enablePathPerturbation: false,
        perturbationStrength: 0.2,
        perturbationFrequency: 150,
        perturbationOctaves: 2,
        
        enableTerrainInfluence: false,
        terrainNoiseScale: 200,
        terrainInfluenceStrength: 0.5,
        terrainSteepnessThreshold: 0.3,
        
        enableHistoricalLayers: false,
        historicalLayerRadius: 200,
        modernLayerStart: 500,
        oldCityPerturbation: 2.0,
        modernCityPerturbation: 0.3,
        
        enableDirectionalBias: false,
        biasDirection: 0,
        biasStrength: 0.3,
        biasNoiseScale: 200,
    };

    private redraw: boolean = true;

    constructor(private guiFolder: dat.GUI, 
                private tensorField: TensorField, 
                private closeTensorFolder: () => void,
                private dragController: DragController) {
    guiFolder.add({'生成全部': () => this.generateEverything()}, '生成全部');
    // guiFolder.add(this, 'simpleBenchMark');
    const animateController = guiFolder.add(this, 'animate').name('动画开关');
    guiFolder.add(this, 'animationSpeed').name('动画速度');

        this.coastlineParams = Object.assign({
            coastNoise: {
                noiseEnabled: true,
                noiseSize: 30,
                noiseAngle: 20,
            },
            riverNoise: {
                noiseEnabled: true,
                noiseSize: 30,
                noiseAngle: 20,
            },
            riverBankSize: 10,
            riverSize: 30,
        }, this.minorParams);
        this.coastlineParams.pathIterations = 10000;
        this.coastlineParams.simplifyTolerance = 10;

        this.majorParams = Object.assign({}, this.minorParams);
        this.majorParams.dsep = 100;
        this.majorParams.dtest = 30;
        this.majorParams.dlookahead = 200;
        this.majorParams.collideEarly = 0;

        this.mainParams = Object.assign({}, this.minorParams);
        this.mainParams.dsep = 400;
        this.mainParams.dtest = 200;
        this.mainParams.dlookahead = 500;
        this.mainParams.collideEarly = 0;

        const integrator = new RK4Integrator(tensorField, this.minorParams);
        const redraw = () => this.redraw = true;

        this.coastline = new WaterGUI(tensorField, this.coastlineParams, integrator,
            this.guiFolder, closeTensorFolder, '水系', redraw).initFolder();
        
        // 创建道路文件夹
        const roadsFolder = this.guiFolder.addFolder('道路');
        
        // 添加统一的真实性增强设置
        this.addUnifiedRealismEnhancementsFolder(roadsFolder);
        
        this.mainRoads = new RoadGUI(this.mainParams, integrator, roadsFolder, closeTensorFolder, '主干道', redraw).initFolder();
        this.majorRoads = new RoadGUI(this.majorParams, integrator, roadsFolder, closeTensorFolder, '主要道路', redraw, this.animate).initFolder();
        this.minorRoads = new RoadGUI(this.minorParams, integrator, roadsFolder, closeTensorFolder, '次要道路', redraw, this.animate).initFolder();
        
        // 城市边界 UI
        this.cityBoundary = new CityBoundary(dragController, redraw);
        const boundaryFolder = guiFolder.addFolder('城市边界');
        boundaryFolder.add(this.cityBoundary, 'enabled').name('启用边界').onChange(() => this.updateBoundaryChecker());
        boundaryFolder.add(this.cityBoundary, 'editMode').name('编辑模式');
        boundaryFolder.add({重置边界: () => this.cityBoundary.reset()}, '重置边界');
        
        // 添加画布点击监听器用于编辑边界
        this.setupBoundaryClickListener();
        
        const parks = guiFolder.addFolder('公园');
        parks.add({生成: () => {
            this.buildings.reset();
            this.addParks();
            this.redraw = true;
        }}, '生成');
    parks.add(this, 'clusterBigParks').name('聚合大公园');
    parks.add(this, 'numBigParks').name('大公园数量');
    parks.add(this, 'numSmallParks').name('小公园数量');

    const buildingsFolder = guiFolder.addFolder('建筑');
        this.buildings = new Buildings(tensorField, buildingsFolder, redraw, this.minorParams.dstep, this.animate);
        this.buildings.setPreGenerateCallback(() => {
            const allStreamlines = [];
            allStreamlines.push(...this.mainRoads.allStreamlines);
            allStreamlines.push(...this.majorRoads.allStreamlines);
            allStreamlines.push(...this.minorRoads.allStreamlines);
            allStreamlines.push(...this.coastline.streamlinesWithSecondaryRoad);
            this.buildings.setAllStreamlines(allStreamlines);
            
            // 设置道路数据用于用地分类
            this.buildings.setRoadsForClassification(
                this.mainRoads.allStreamlines,
                this.majorRoads.allStreamlines
            );
        });

        // 初始化边界检测器
        this.updateBoundaryChecker();

        animateController.onChange((b: boolean) => {
            this.majorRoads.animate = b;
            this.minorRoads.animate = b;
            this.buildings.animate = b;
        });

        this.minorRoads.setExistingStreamlines([this.coastline, this.mainRoads, this.majorRoads]);
        this.majorRoads.setExistingStreamlines([this.coastline, this.mainRoads]);
        this.mainRoads.setExistingStreamlines([this.coastline]);

        this.coastline.setPreGenerateCallback(() => {
            this.mainRoads.clearStreamlines();
            this.majorRoads.clearStreamlines();
            this.minorRoads.clearStreamlines();
            this.bigParks = [];
            this.smallParks = [];
            this.buildings.reset();
            tensorField.parks = [];
            tensorField.sea = [];
            tensorField.river = [];
        });

        this.mainRoads.setPreGenerateCallback(() => {
            this.majorRoads.clearStreamlines();
            this.minorRoads.clearStreamlines();
            this.bigParks = [];
            this.smallParks = [];
            this.buildings.reset();
            tensorField.parks = [];
            tensorField.ignoreRiver = true;
        });

        this.mainRoads.setPostGenerateCallback(() => {
            tensorField.ignoreRiver = false;
        });

        this.majorRoads.setPreGenerateCallback(() => {
            this.minorRoads.clearStreamlines();
            this.bigParks = [];
            this.smallParks = [];
            this.buildings.reset();
            tensorField.parks = [];
            tensorField.ignoreRiver = true;
        });

        this.majorRoads.setPostGenerateCallback(() => {
            tensorField.ignoreRiver = false;
            this.addParks();
            this.redraw = true;
        });

        this.minorRoads.setPreGenerateCallback(() => {
            this.buildings.reset();
            this.smallParks = [];
            tensorField.parks = this.bigParks;
        });

        this.minorRoads.setPostGenerateCallback(() => {
            this.addParks();
        });
    }

    /**
     * 更新所有组件的边界检测器
     */
    private updateBoundaryChecker(): void {
        const checker = this.cityBoundary.enabled 
            ? (point: Vector) => this.cityBoundary.contains(point)
            : null;
        
        this.coastline.setBoundaryChecker(checker);
        this.mainRoads.setBoundaryChecker(checker);
        this.majorRoads.setBoundaryChecker(checker);
        this.minorRoads.setBoundaryChecker(checker);
        this.buildings.setBoundaryChecker(checker);
    }

    /**
     * 设置画布点击监听器，用于在编辑模式下添加/删除边界顶点
     */
    private setupBoundaryClickListener(): void {
        const canvas = document.getElementById('mapCanvas');
        if (!canvas) return;
        
        canvas.addEventListener('click', (event: MouseEvent) => {
            if (!this.cityBoundary.editMode) return;
            
            const rect = canvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            
            this.cityBoundary.addVertex(new Vector(x, y));
        });
    }

    addParks(): void {
        const g = new Graph(this.majorRoads.allStreamlines
            .concat(this.mainRoads.allStreamlines)
            .concat(this.minorRoads.allStreamlines), this.minorParams.dstep);
        this.intersections = g.intersections;

        const p = new PolygonFinder(g.nodes, {
                maxLength: 20,
                minArea: 80,
                shrinkSpacing: 4,
                chanceNoDivide: 1,
            }, this.tensorField);
        p.findPolygons();
        const polygons = p.polygons;

        if (this.minorRoads.allStreamlines.length === 0) {
            // Big parks
            this.bigParks = [];
            this.smallParks = [];
            if (polygons.length > this.numBigParks) {
                if (this.clusterBigParks) {
                    // Group in adjacent polygons 
                    const parkIndex = Math.floor(Math.random() * (polygons.length - this.numBigParks));
                    for (let i = parkIndex; i < parkIndex + this.numBigParks; i++) {
                        this.bigParks.push(polygons[i]);    
                    }
                } else {
                    for (let i = 0; i < this.numBigParks; i++) {
                        const parkIndex = Math.floor(Math.random() * polygons.length);
                        this.bigParks.push(polygons[parkIndex]);
                    }
                }
            } else {
                this.bigParks.push(...polygons);
            }
        } else {
            // Small parks
            this.smallParks = [];
            for (let i = 0; i < this.numSmallParks; i++) {
                const parkIndex = Math.floor(Math.random() * polygons.length);
                this.smallParks.push(polygons[parkIndex]);
            }
        }

        this.tensorField.parks = [];
        this.tensorField.parks.push(...this.bigParks);
        this.tensorField.parks.push(...this.smallParks);
    }

    async generateEverything() {
        this.coastline.generateRoads();
        await this.mainRoads.generateRoads();
        await this.majorRoads.generateRoads(this.animate);
        await this.minorRoads.generateRoads(this.animate);
        this.redraw = true;
        await this.buildings.generate(this.animate);
    }

    update() {
        let continueUpdate = true;
        const start = performance.now();
        while (continueUpdate && performance.now() - start < this.animationSpeed) {
            const minorChanged = this.minorRoads.update();
            const majorChanged = this.majorRoads.update();
            const mainChanged = this.mainRoads.update();
            const buildingsChanged = this.buildings.update();
            continueUpdate = minorChanged || majorChanged || mainChanged || buildingsChanged;
        }
        
        this.redraw = this.redraw || continueUpdate;
    }

    draw(style: Style, forceDraw=false, customCanvas?: CanvasWrapper): void {
        if (!style.needsUpdate && !forceDraw && !this.redraw && !this.domainController.moved) {
            return;
        }

        style.needsUpdate = false;
        this.domainController.moved = false;
        this.redraw = false;

        style.seaPolygon = this.coastline.seaPolygon;
        style.coastline = this.coastline.coastline;
        style.river = this.coastline.river;
        style.lots = this.buildings.lots;

        // 如果启用了3D建筑模型或用地染色，都需要设置 buildingModels
        if ((style instanceof DefaultStyle && style.showBuildingModels) || 
            style instanceof RoughStyle || 
            style.enableLandUseColoring) {
            style.buildingModels = this.buildings.models;    
        }

        style.parks = [];
        style.parks.push(...this.bigParks.map(p => p.map(v => this.domainController.worldToScreen(v.clone()))));
        style.parks.push(...this.smallParks.map(p => p.map(v => this.domainController.worldToScreen(v.clone()))));
        style.minorRoads = this.minorRoads.roads;
        style.majorRoads = this.majorRoads.roads;
        style.mainRoads = this.mainRoads.roads;
        style.coastlineRoads = this.coastline.roads;
        style.secondaryRiver = this.coastline.secondaryRiver;
        style.draw(customCanvas);
        
        // 绘制城市边界（在所有内容之上）
        if (this.cityBoundary.enabled && !customCanvas) {
            this.drawCityBoundary(style);
        }
    }

    /**
     * 绘制城市边界多边形（通用方法，支持任意canvas）
     */
    private drawCityBoundaryOnCanvas(ctx: CanvasRenderingContext2D): void {
        const vertices = this.cityBoundary.verticesScreen;
        
        if (vertices.length < 3) return;
        
        ctx.save();
        ctx.strokeStyle = this.cityBoundary.editMode ? '#ff0000' : '#00aaff';
        ctx.lineWidth = this.cityBoundary.editMode ? 3 : 2;
        ctx.setLineDash(this.cityBoundary.editMode ? [] : [10, 5]);
        
        ctx.beginPath();
        ctx.moveTo(vertices[0].x, vertices[0].y);
        for (let i = 1; i < vertices.length; i++) {
            ctx.lineTo(vertices[i].x, vertices[i].y);
        }
        ctx.closePath();
        ctx.stroke();
        
        // 在编辑模式下绘制顶点
        if (this.cityBoundary.editMode) {
            ctx.fillStyle = '#ff0000';
            for (const v of vertices) {
                ctx.beginPath();
                ctx.arc(v.x, v.y, 6, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        
        ctx.restore();
    }

    /**
     * 绘制城市边界多边形（在Style上）
     */
    private drawCityBoundary(style: Style): void {
        // 使用原生canvas API绘制（需要访问DefaultStyle的canvas）
        if (style instanceof DefaultStyle) {
            const canvas = (style as any).canvas as DefaultCanvasWrapper;
            const ctx = (canvas as any).ctx as CanvasRenderingContext2D;
            this.drawCityBoundaryOnCanvas(ctx);
        }
    }

    /**
     * 添加统一的道路真实性增强设置面板
     * 可以一键设置所有道路层级的真实性参数
     */
    private addUnifiedRealismEnhancementsFolder(roadsFolder: dat.GUI): void {
        const realismFolder = roadsFolder.addFolder('真实性增强(统一设置)');
        
        // 创建一个共享的参数对象用于UI显示
        const sharedParams = {
            // 路径扰动
            enablePathPerturbation: false,
            perturbationStrength: 0.2,
            perturbationFrequency: 150,
            perturbationOctaves: 2,
            
            // 地形影响
            enableTerrainInfluence: false,
            terrainNoiseScale: 200,
            terrainInfluenceStrength: 0.5,
            terrainSteepnessThreshold: 0.3,
            
            // 历史分层
            enableHistoricalLayers: false,
            historicalLayerRadius: 200,
            modernLayerStart: 500,
            oldCityPerturbation: 2.0,
            modernCityPerturbation: 0.3,
            
            // 方向偏好
            enableDirectionalBias: false,
            biasDirection: 0,
            biasStrength: 0.3,
            biasNoiseScale: 200,
        };
        
        // 应用到所有道路的函数
        const applyToAllRoads = () => {
            // 复制所有真实性参数到三个道路层级
            const roadParams = [this.mainParams, this.majorParams, this.minorParams];
            for (const params of roadParams) {
                params.enablePathPerturbation = sharedParams.enablePathPerturbation;
                params.perturbationStrength = sharedParams.perturbationStrength;
                params.perturbationFrequency = sharedParams.perturbationFrequency;
                params.perturbationOctaves = sharedParams.perturbationOctaves;
                
                params.enableTerrainInfluence = sharedParams.enableTerrainInfluence;
                params.terrainNoiseScale = sharedParams.terrainNoiseScale;
                params.terrainInfluenceStrength = sharedParams.terrainInfluenceStrength;
                params.terrainSteepnessThreshold = sharedParams.terrainSteepnessThreshold;
                
                params.enableHistoricalLayers = sharedParams.enableHistoricalLayers;
                params.historicalLayerRadius = sharedParams.historicalLayerRadius;
                params.modernLayerStart = sharedParams.modernLayerStart;
                params.oldCityPerturbation = sharedParams.oldCityPerturbation;
                params.modernCityPerturbation = sharedParams.modernCityPerturbation;
                
                params.enableDirectionalBias = sharedParams.enableDirectionalBias;
                params.biasDirection = sharedParams.biasDirection;
                params.biasStrength = sharedParams.biasStrength;
                params.biasNoiseScale = sharedParams.biasNoiseScale;
            }
            
            // 更新所有道路层级的GUI
            Util.updateGui(roadsFolder);
            log.info('已将真实性增强设置应用到所有道路层级');
        };
        
        // 预设配置
        const presets = {
            '应用到所有道路': applyToAllRoads,
            '无增强': () => {
                sharedParams.enablePathPerturbation = false;
                sharedParams.enableTerrainInfluence = false;
                sharedParams.enableHistoricalLayers = false;
                sharedParams.enableDirectionalBias = false;
                applyToAllRoads();
            },
            '默认(现代)': () => {
                sharedParams.enablePathPerturbation = true;
                sharedParams.perturbationStrength = 0.1;
                sharedParams.perturbationFrequency = 200;
                sharedParams.perturbationOctaves = 2;
                sharedParams.enableTerrainInfluence = false;
                sharedParams.enableHistoricalLayers = false;
                sharedParams.enableDirectionalBias = false;
                applyToAllRoads();
            },
            '老城区': () => {
                sharedParams.enablePathPerturbation = true;
                sharedParams.perturbationStrength = 0.4;
                sharedParams.perturbationFrequency = 80;
                sharedParams.perturbationOctaves = 3;
                sharedParams.enableTerrainInfluence = true;
                sharedParams.terrainNoiseScale = 150;
                sharedParams.terrainInfluenceStrength = 0.5;
                sharedParams.terrainSteepnessThreshold = 0.3;
                sharedParams.enableHistoricalLayers = false;
                sharedParams.enableDirectionalBias = false;
                applyToAllRoads();
            },
            '混合城市': () => {
                sharedParams.enablePathPerturbation = true;
                sharedParams.perturbationStrength = 0.25;
                sharedParams.perturbationFrequency = 150;
                sharedParams.perturbationOctaves = 2;
                sharedParams.enableTerrainInfluence = false;
                sharedParams.enableHistoricalLayers = true;
                sharedParams.historicalLayerRadius = 200;
                sharedParams.modernLayerStart = 500;
                sharedParams.oldCityPerturbation = 2.0;
                sharedParams.modernCityPerturbation = 0.3;
                sharedParams.enableDirectionalBias = false;
                applyToAllRoads();
            },
            '地形适应': () => {
                sharedParams.enablePathPerturbation = true;
                sharedParams.perturbationStrength = 0.15;
                sharedParams.perturbationFrequency = 180;
                sharedParams.perturbationOctaves = 2;
                sharedParams.enableTerrainInfluence = true;
                sharedParams.terrainNoiseScale = 200;
                sharedParams.terrainInfluenceStrength = 1.0;
                sharedParams.terrainSteepnessThreshold = 0.2;
                sharedParams.enableHistoricalLayers = false;
                sharedParams.enableDirectionalBias = false;
                applyToAllRoads();
            },
        };
        
        // 预设按钮
        realismFolder.add(presets, '应用到所有道路').name('⚡ 应用当前设置');
        realismFolder.add(presets, '无增强');
        realismFolder.add(presets, '默认(现代)');
        realismFolder.add(presets, '老城区');
        realismFolder.add(presets, '混合城市');
        realismFolder.add(presets, '地形适应');
        
        // 路径扰动
        const perturbFolder = realismFolder.addFolder('路径扰动');
        perturbFolder.add(sharedParams, 'enablePathPerturbation').name('启用路径扰动').onChange(applyToAllRoads);
        perturbFolder.add(sharedParams, 'perturbationStrength', 0, 1).name('扰动强度').step(0.01).onChange(applyToAllRoads);
        perturbFolder.add(sharedParams, 'perturbationFrequency', 10, 500).name('扰动频率(规模)').step(10).onChange(applyToAllRoads);
        perturbFolder.add(sharedParams, 'perturbationOctaves', 1, 5).name('噪声叠加层数').step(1).onChange(applyToAllRoads);
        
        // 地形影响
        const terrainFolder = realismFolder.addFolder('地形影响');
        terrainFolder.add(sharedParams, 'enableTerrainInfluence').name('启用地形影响').onChange(applyToAllRoads);
        terrainFolder.add(sharedParams, 'terrainNoiseScale', 50, 500).name('地形噪声规模').step(10).onChange(applyToAllRoads);
        terrainFolder.add(sharedParams, 'terrainInfluenceStrength', 0, 2).name('地形影响强度').step(0.1).onChange(applyToAllRoads);
        terrainFolder.add(sharedParams, 'terrainSteepnessThreshold', 0, 1).name('陡峭度阈值').step(0.05).onChange(applyToAllRoads);
        
        // 历史分层
        const historyFolder = realismFolder.addFolder('历史分层');
        historyFolder.add(sharedParams, 'enableHistoricalLayers').name('启用历史分层').onChange(applyToAllRoads);
        historyFolder.add(sharedParams, 'historicalLayerRadius', 50, 500).name('老城区半径').step(10).onChange(applyToAllRoads);
        historyFolder.add(sharedParams, 'modernLayerStart', 200, 1000).name('现代区域起始半径').step(10).onChange(applyToAllRoads);
        historyFolder.add(sharedParams, 'oldCityPerturbation', 0.5, 3).name('老城区扰动倍数').step(0.1).onChange(applyToAllRoads);
        historyFolder.add(sharedParams, 'modernCityPerturbation', 0, 1).name('现代区域扰动倍数').step(0.1).onChange(applyToAllRoads);
        
        // 方向偏好
        const biasFolder = realismFolder.addFolder('方向偏好');
        biasFolder.add(sharedParams, 'enableDirectionalBias').name('启用方向偏好').onChange(applyToAllRoads);
        biasFolder.add(sharedParams, 'biasDirection', -Math.PI, Math.PI).name('偏好方向(弧度)').step(0.1).onChange(applyToAllRoads);
        biasFolder.add(sharedParams, 'biasStrength', 0, 1).name('偏好强度').step(0.05).onChange(applyToAllRoads);
        biasFolder.add(sharedParams, 'biasNoiseScale', 50, 500).name('偏好噪声规模').step(10).onChange(applyToAllRoads);
        
        // 添加说明
        const helpText = realismFolder.addFolder('💡 使用说明');
        // dat.GUI不支持纯文本,但我们可以添加一个只读控制器
        const help = {
            说明: '调整参数后点击"应用到所有道路"按钮,\n或直接点击预设按钮一键设置。\n也可在各道路子菜单中单独设置。'
        };
        // 这个控制器只是用来显示说明,不可编辑
    }

    /**
     * 公开方法：在任意canvas上绘制城市边界(如果启用)
     */
    drawCityBoundaryIfEnabled(canvas: CanvasWrapper): void {
        if (!this.cityBoundary.enabled) return;
        
        if (canvas instanceof DefaultCanvasWrapper) {
            const ctx = (canvas as any).ctx as CanvasRenderingContext2D;
            this.drawCityBoundaryOnCanvas(ctx);
        }
    }

    /**
     * 检查是否处于边界编辑模式
     */
    isBoundaryEditMode(): boolean {
        return this.cityBoundary.enabled && this.cityBoundary.editMode;
    }

    roadsEmpty(): boolean {
        return this.majorRoads.roadsEmpty()
            && this.minorRoads.roadsEmpty()
            && this.mainRoads.roadsEmpty()
            && this.coastline.roadsEmpty();
    }

    // OBJ Export methods

    public get seaPolygon(): Vector[] {
        return this.coastline.seaPolygon;
    }

    public get riverPolygon(): Vector[] {
        return this.coastline.river;
    }

    public get buildingModels(): BuildingModel[] {
        return this.buildings.models;
    }

    public getBlocks(): Promise<Vector[][]> {
        return this.buildings.getBlocks();
    }

    public get minorRoadPolygons(): Vector[][] {
        return this.minorRoads.roads.map(r => PolygonUtil.resizeGeometry(r, 1 * this.domainController.zoom, false));
    }

    public get majorRoadPolygons(): Vector[][] {
        return this.majorRoads.roads.concat([this.coastline.secondaryRiver]).map(r => PolygonUtil.resizeGeometry(r, 2 * this.domainController.zoom, false));
    }

    public get mainRoadPolygons(): Vector[][] {
        return this.mainRoads.roads.concat(this.coastline.roads).map(r => PolygonUtil.resizeGeometry(r, 2.5 * this.domainController.zoom, false));
    }

    public get coastlinePolygon(): Vector[] {
        return PolygonUtil.resizeGeometry(this.coastline.coastline, 15 * this.domainController.zoom, false);
    }
}
