import * as log from 'loglevel';
import CanvasWrapper from './canvas_wrapper';
import DomainController from './domain_controller';
import Util from '../util';
import FieldIntegrator from '../impl/integrator';
import {StreamlineParams, BoundaryChecker} from '../impl/streamlines';
import StreamlineGenerator from '../impl/streamlines';
import Vector from '../vector';

/**
 * Handles creation of roads
 */
export default class RoadGUI {
    protected streamlines: StreamlineGenerator;
    private existingStreamlines: RoadGUI[] = [];
    protected domainController = DomainController.getInstance();
    protected preGenerateCallback: () => any = () => {};
    protected postGenerateCallback: () => any = () => {};

    private streamlinesInProgress: boolean = false;
    protected boundaryChecker: BoundaryChecker | null = null;

    constructor(protected params: StreamlineParams,
                protected integrator: FieldIntegrator,
                protected guiFolder: dat.GUI,
                protected closeTensorFolder: () => void,
                protected folderName: string,
                protected redraw: () => void,
                protected _animate=false) {
        this.streamlines = new StreamlineGenerator(
            this.integrator, this.domainController.origin,
            this.domainController.worldDimensions, this.params);

        // Update path iterations based on window size
        this.setPathIterations();
        window.addEventListener('resize', (): void => this.setPathIterations());
    }

    initFolder(): RoadGUI {
        const roadGUI = {
            生成: () => this.generateRoads(this._animate).then(() => this.redraw()),
            连接末端: (): void => {
                this.streamlines.joinDanglingStreamlines();
                this.redraw();
            },
        };

        const folder = this.guiFolder.addFolder(this.folderName);
        folder.add(roadGUI, '生成');
        // folder.add(roadGUI, '连接末端');
        
        const paramsFolder = folder.addFolder('参数');
        paramsFolder.add(this.params, 'dsep').name('分离距离 (dsep)');
        paramsFolder.add(this.params, 'dtest').name('检测距离 (dtest)');
        
        // === 真实性增强面板 ===
        this.addRealismEnhancementsFolder(folder);

        const devParamsFolder = paramsFolder.addFolder('开发');
        this.addDevParamsToFolder(this.params, devParamsFolder);
        return this;
    }
    
    /**
     * 添加真实性增强控制面板
     */
    protected addRealismEnhancementsFolder(parentFolder: dat.GUI): void {
        const realismFolder = parentFolder.addFolder('真实性增强');
        
        // 路径扰动
        const perturbFolder = realismFolder.addFolder('路径扰动');
        perturbFolder.add(this.params, 'enablePathPerturbation').name('启用路径扰动');
        perturbFolder.add(this.params, 'perturbationStrength', 0, 1).name('扰动强度').step(0.01);
        perturbFolder.add(this.params, 'perturbationFrequency', 10, 500).name('扰动频率(规模)').step(10);
        perturbFolder.add(this.params, 'perturbationOctaves', 1, 5).name('噪声叠加层数').step(1);
        
        // 地形影响
        const terrainFolder = realismFolder.addFolder('地形影响');
        terrainFolder.add(this.params, 'enableTerrainInfluence').name('启用地形影响');
        terrainFolder.add(this.params, 'terrainNoiseScale', 50, 500).name('地形噪声规模').step(10);
        terrainFolder.add(this.params, 'terrainInfluenceStrength', 0, 2).name('地形影响强度').step(0.1);
        terrainFolder.add(this.params, 'terrainSteepnessThreshold', 0, 1).name('陡峭度阈值').step(0.05);
        
        // 历史分层
        const historyFolder = realismFolder.addFolder('历史分层');
        historyFolder.add(this.params, 'enableHistoricalLayers').name('启用历史分层');
        historyFolder.add(this.params, 'historicalLayerRadius', 50, 500).name('老城区半径').step(10);
        historyFolder.add(this.params, 'modernLayerStart', 200, 1000).name('现代区域起始半径').step(10);
        historyFolder.add(this.params, 'oldCityPerturbation', 0.5, 3).name('老城区扰动倍数').step(0.1);
        historyFolder.add(this.params, 'modernCityPerturbation', 0, 1).name('现代区域扰动倍数').step(0.1);
        
        // 方向偏好
        const biasFolder = realismFolder.addFolder('方向偏好');
        biasFolder.add(this.params, 'enableDirectionalBias').name('启用方向偏好');
        biasFolder.add(this.params, 'biasDirection', -Math.PI, Math.PI).name('偏好方向(弧度)').step(0.1);
        biasFolder.add(this.params, 'biasStrength', 0, 1).name('偏好强度').step(0.05);
        biasFolder.add(this.params, 'biasNoiseScale', 50, 500).name('偏好噪声规模').step(10);
        
        // 预设
        const presets = {
            '默认(现代)': () => this.applyPreset('modern'),
            '老城区': () => this.applyPreset('oldCity'),
            '混合城市': () => this.applyPreset('mixed'),
            '地形适应': () => this.applyPreset('terrain'),
            '无增强': () => this.applyPreset('none'),
        };
        
        realismFolder.add(presets, '默认(现代)');
        realismFolder.add(presets, '老城区');
        realismFolder.add(presets, '混合城市');
        realismFolder.add(presets, '地形适应');
        realismFolder.add(presets, '无增强');
    }
    
    /**
     * 应用预设配置
     */
    protected applyPreset(preset: string): void {
        switch(preset) {
            case 'none':
                this.params.enablePathPerturbation = false;
                this.params.enableTerrainInfluence = false;
                this.params.enableHistoricalLayers = false;
                this.params.enableDirectionalBias = false;
                break;
                
            case 'modern':
                this.params.enablePathPerturbation = true;
                this.params.perturbationStrength = 0.1;
                this.params.perturbationFrequency = 200;
                this.params.perturbationOctaves = 2;
                this.params.enableTerrainInfluence = false;
                this.params.enableHistoricalLayers = false;
                this.params.enableDirectionalBias = false;
                break;
                
            case 'oldCity':
                this.params.enablePathPerturbation = true;
                this.params.perturbationStrength = 0.4;
                this.params.perturbationFrequency = 80;
                this.params.perturbationOctaves = 3;
                this.params.enableTerrainInfluence = true;
                this.params.terrainNoiseScale = 150;
                this.params.terrainInfluenceStrength = 0.5;
                this.params.terrainSteepnessThreshold = 0.3;
                this.params.enableHistoricalLayers = false;
                this.params.enableDirectionalBias = false;
                break;
                
            case 'mixed':
                this.params.enablePathPerturbation = true;
                this.params.perturbationStrength = 0.25;
                this.params.perturbationFrequency = 150;
                this.params.perturbationOctaves = 2;
                this.params.enableTerrainInfluence = false;
                this.params.enableHistoricalLayers = true;
                this.params.historicalLayerRadius = 200;
                this.params.modernLayerStart = 500;
                this.params.oldCityPerturbation = 2.0;
                this.params.modernCityPerturbation = 0.3;
                this.params.enableDirectionalBias = false;
                break;
                
            case 'terrain':
                this.params.enablePathPerturbation = true;
                this.params.perturbationStrength = 0.15;
                this.params.perturbationFrequency = 180;
                this.params.perturbationOctaves = 2;
                this.params.enableTerrainInfluence = true;
                this.params.terrainNoiseScale = 200;
                this.params.terrainInfluenceStrength = 1.0;
                this.params.terrainSteepnessThreshold = 0.2;
                this.params.enableHistoricalLayers = false;
                this.params.enableDirectionalBias = false;
                break;
        }
        
        Util.updateGui(this.guiFolder);
        log.info(`应用预设: ${preset}`);
    }

    set animate(b: boolean) {
        this._animate = b;
    }

    get allStreamlines(): Vector[][] {
        return this.streamlines.allStreamlinesSimple;
    }

    get roads(): Vector[][] {
        // For drawing not generation, probably fine to leave map
        return this.streamlines.allStreamlinesSimple.map(s =>
            s.map(v => this.domainController.worldToScreen(v.clone()))
        );
    }

    roadsEmpty(): boolean {
        return this.streamlines.allStreamlinesSimple.length === 0;
    }

    setExistingStreamlines(existingStreamlines: RoadGUI[]): void {
        this.existingStreamlines = existingStreamlines;
    }

    setPreGenerateCallback(callback: () => any) {
        this.preGenerateCallback = callback;
    }

    setPostGenerateCallback(callback: () => any) {
        this.postGenerateCallback = callback;
    }

    clearStreamlines(): void {
        this.streamlines.clearStreamlines();
    }

    setBoundaryChecker(checker: BoundaryChecker | null): void {
        this.boundaryChecker = checker;
    }

    async generateRoads(animate=false): Promise<unknown> {
        this.preGenerateCallback();

        this.domainController.zoom = this.domainController.zoom / Util.DRAW_INFLATE_AMOUNT;
        this.streamlines = new StreamlineGenerator(
            this.integrator, this.domainController.origin,
            this.domainController.worldDimensions, Object.assign({},this.params));
        this.domainController.zoom = this.domainController.zoom * Util.DRAW_INFLATE_AMOUNT;

        // 设置边界检测器
        if (this.boundaryChecker) {
            this.streamlines.setBoundaryChecker(this.boundaryChecker);
        }

        for (const s of this.existingStreamlines) {
            this.streamlines.addExistingStreamlines(s.streamlines)   
        }

        this.closeTensorFolder();
        this.redraw();
        
        return this.streamlines.createAllStreamlines(animate).then(() => this.postGenerateCallback());
    }

    /**
     * Returns true if streamlines changes
     */
    update(): boolean {
        return this.streamlines.update();
    }

    protected addDevParamsToFolder(params: StreamlineParams, folder: dat.GUI): void {
        folder.add(params, 'pathIterations').name('路径迭代次数');
        folder.add(params, 'seedTries').name('种子尝试次数');
        folder.add(params, 'dstep').name('步长 (dstep)');
        folder.add(params, 'dlookahead').name('前瞻距离 (dlookahead)');
        folder.add(params, 'dcirclejoin').name('圆形连接 (dcirclejoin)');
        folder.add(params, 'joinangle').name('连接角度');
        folder.add(params, 'simplifyTolerance').name('简化容差');
        folder.add(params, 'collideEarly').name('提前碰撞检测');
    }

    /**
     * Sets path iterations so that a road can cover the screen
     */
    private setPathIterations(): void {
        const max = 1.5 * Math.max(window.innerWidth, window.innerHeight);
        this.params.pathIterations = max/this.params.dstep;
        Util.updateGui(this.guiFolder);
    }
}
