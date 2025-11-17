import * as log from 'loglevel';
import DomainController from './domain_controller';
import TensorField from '../impl/tensor_field';
import Graph from '../impl/graph';
import Vector from '../vector';
import PolygonFinder from '../impl/polygon_finder';
import {PolygonParams} from '../impl/polygon_finder';
import {BoundaryChecker} from '../impl/streamlines';
import LandUseClassifier, {LandUseType, LandUseInfo, LandUseConfig} from '../impl/land_use_classifier';


export interface BuildingModel {
    height: number;
    lotWorld: Vector[]; // In world space
    lotScreen: Vector[]; // In screen space
    roof: Vector[]; // In screen space
    sides: Vector[][]; // In screen space
    landUseType?: LandUseType; // 用地类型
}

/**
 * Pseudo 3D buildings
 */
class BuildingModels {
    private domainController = DomainController.getInstance();
    private _buildingModels: BuildingModel[] = [];

    constructor(lots: Vector[][], landUseTypes?: LandUseType[]) {  // Lots in world space
        for (let i = 0; i < lots.length; i++) {
            const lot = lots[i];
            this._buildingModels.push({
                height: Math.random() * 20 + 20,
                lotWorld: lot,
                lotScreen: [],
                roof: [],
                sides: [],
                landUseType: landUseTypes ? landUseTypes[i] : undefined
            });
        }
        this._buildingModels.sort((a, b) => a.height - b.height);
    }

    get buildingModels(): BuildingModel[] {
        return this._buildingModels;
    }

    /**
     * Recalculated when the camera moves
     */
    setBuildingProjections(): void {
        const d = 1000 / this.domainController.zoom;
        const cameraPos = this.domainController.getCameraPosition();
        for (const b of this._buildingModels) {
            b.lotScreen = b.lotWorld.map(v => this.domainController.worldToScreen(v.clone()));
            b.roof = b.lotScreen.map(v => this.heightVectorToScreen(v, b.height, d, cameraPos));
            b.sides = this.getBuildingSides(b);
        }
    }

    private heightVectorToScreen(v: Vector, h: number, d: number, camera: Vector): Vector {
        const scale = (d / (d - h)); // 0.1
        if (this.domainController.orthographic) {
            const diff = this.domainController.cameraDirection.multiplyScalar(-h * scale);
            return v.clone().add(diff);
        } else {
            return v.clone().sub(camera).multiplyScalar(scale).add(camera);
        }
    }

    /**
     * Get sides of buildings by joining corresponding edges between the roof and ground
     */
    private getBuildingSides(b: BuildingModel): Vector[][] {
        const polygons: Vector[][] = [];
        for (let i = 0; i < b.lotScreen.length; i++) {
            const next = (i + 1) % b.lotScreen.length;
            polygons.push([b.lotScreen[i], b.lotScreen[next], b.roof[next], b.roof[i]]);
        }
        return polygons;
    }
}

/**
 * Finds building lots and optionally pseudo3D buildings
 */
export default class Buildings {
    private polygonFinder: PolygonFinder;
    private allStreamlines: Vector[][] = [];
    private domainController = DomainController.getInstance();
    private preGenerateCallback: () => any = () => {};
    private postGenerateCallback: () => any = () => {};
    private _models: BuildingModels = new BuildingModels([]);
    private _blocks: Vector[][] = [];
    // Filtered lots after applying density and range
    private _filteredLots: Vector[][] = [];
    
    // 用地分类相关
    private _enableLandUseColoring: boolean = false;
    private _landUseInfos: LandUseInfo[] = [];
    private _mainRoads: Vector[][] = [];
    private _majorRoads: Vector[][] = [];
    private _landUseConfig: Partial<LandUseConfig> = {};  // 用户自定义配置

    // Config
    private _density: number = 1.0; // 0..1 fraction of lots kept
    private _boundaryChecker: BoundaryChecker | null = null;

    private buildingParams: PolygonParams = {
        maxLength: 20,
        minArea: 50,
        shrinkSpacing: 4,
        chanceNoDivide: 0.05,
    };

    constructor(private tensorField: TensorField,
                folder: dat.GUI,
                private redraw: () => void,
                private dstep: number,
                private _animate: boolean) {
        folder.add({'生成建筑': () => this.generate(this._animate)}, '生成建筑');
        folder.add(this.buildingParams, 'minArea').name('最小面积');
        folder.add(this.buildingParams, 'shrinkSpacing').name('收缩间距');
        folder.add(this.buildingParams, 'chanceNoDivide').name('不分割概率');
        folder.add(this, 'density', 0, 1, 0.05).name('建筑密度');
        this.polygonFinder = new PolygonFinder([], this.buildingParams, this.tensorField);
    }

    set animate(v: boolean) {
        this._animate = v;
    }

    get lots(): Vector[][] {
        const lots = this._filteredLots.length > 0 ? this._filteredLots : this.polygonFinder.polygons;
        return lots.map(p => p.map(v => this.domainController.worldToScreen(v.clone())));
    }

    /**
     * Only used when creating the 3D model to 'fake' the roads
     */
    getBlocks(): Promise<Vector[][]> {
        const g = new Graph(this.allStreamlines, this.dstep, true);
        const blockParams = Object.assign({}, this.buildingParams);
        blockParams.shrinkSpacing = blockParams.shrinkSpacing/2;
        const polygonFinder = new PolygonFinder(g.nodes, blockParams, this.tensorField);
        polygonFinder.findPolygons();
        return polygonFinder.shrink(false).then(() => polygonFinder.polygons.map(p => p.map(v => this.domainController.worldToScreen(v.clone()))));
    }

    get models(): BuildingModel[] {
        this._models.setBuildingProjections();
        return this._models.buildingModels;
    }

    setAllStreamlines(s: Vector[][]): void {
        this.allStreamlines = s;
    }

    reset(): void {
        this.polygonFinder.reset();
        this._models = new BuildingModels([]);
    }

    update(): boolean {
        return this.polygonFinder.update();
    }

    /**
     * Finds blocks, shrinks and divides them to create building lots
     */
    async generate(animate: boolean): Promise<void> {
        this.preGenerateCallback();
        this._models = new BuildingModels([]);
        const g = new Graph(this.allStreamlines, this.dstep, true);

        this.polygonFinder = new PolygonFinder(g.nodes, this.buildingParams, this.tensorField);
        this.polygonFinder.findPolygons();
        await this.polygonFinder.shrink(animate);
        await this.polygonFinder.divide(animate);
        
        // Apply post-processing: boundary filter and density
        const sourceLots = this.polygonFinder.polygons;
        let filtered = sourceLots;
        
        // 使用边界检测器过滤
        if (this._boundaryChecker) {
            filtered = filtered.filter(poly => {
                // Use polygon centroid
                const cx = poly.reduce((acc, v) => acc + v.x, 0) / poly.length;
                const cy = poly.reduce((acc, v) => acc + v.y, 0) / poly.length;
                return this._boundaryChecker(new Vector(cx, cy));
            });
        }
        
        // 密度过滤
        if (this._density < 1) {
            const keep: Vector[][] = [];
            for (const p of filtered) {
                if (Math.random() <= Math.max(0, Math.min(1, this._density))) keep.push(p);
            }
            filtered = keep;
        }
        
        this._filteredLots = filtered;
        
        // 应用用地分类
        if (this._enableLandUseColoring && this._filteredLots.length > 0) {
            this.classifyLandUse();
        } else {
            this._landUseInfos = [];
        }
        
        this.redraw();
        
        // 创建建筑模型时传入用地类型
        const landUseTypes = this._landUseInfos.map(info => info.type);
        this._models = new BuildingModels(this._filteredLots, landUseTypes.length > 0 ? landUseTypes : undefined);

        this.postGenerateCallback();
    }

    setPreGenerateCallback(callback: () => any): void {
        this.preGenerateCallback = callback;
    }

    setPostGenerateCallback(callback: () => any): void {
        this.postGenerateCallback = callback;
    }

    // External configuration setters
    setBoundaryChecker(checker: BoundaryChecker | null): void {
        this._boundaryChecker = checker;
        // 重新计算过滤后的地块
        this.refilterLots();
    }

    /**
     * 重新应用边界和密度过滤
     */
    private refilterLots(): void {
        const sourceLots = this.polygonFinder.polygons;
        let filtered = sourceLots;
        
        // 使用边界检测器过滤
        if (this._boundaryChecker) {
            filtered = filtered.filter(poly => {
                const cx = poly.reduce((acc, vv) => acc + vv.x, 0) / poly.length;
                const cy = poly.reduce((acc, vv) => acc + vv.y, 0) / poly.length;
                return this._boundaryChecker(new Vector(cx, cy));
            });
        }
        
        // 密度过滤
        if (this._density < 1) {
            const keep: Vector[][] = [];
            for (const p of filtered) {
                if (Math.random() <= Math.max(0, Math.min(1, this._density))) keep.push(p);
            }
            filtered = keep;
        }
        
        this._filteredLots = filtered;
        
        // 重新分类用地
        if (this._enableLandUseColoring && this._filteredLots.length > 0) {
            this.classifyLandUse();
        }
        
        const landUseTypes = this._landUseInfos.map(info => info.type);
        this._models = new BuildingModels(this._filteredLots, landUseTypes.length > 0 ? landUseTypes : undefined);
        this.redraw();
    }
    
    /**
     * 对地块进行用地类型分类
     */
    private classifyLandUse(): void {
        // 计算地图中心和半径
        const allPoints: Vector[] = [];
        for (const lot of this._filteredLots) {
            allPoints.push(...lot);
        }
        
        if (allPoints.length === 0) {
            this._landUseInfos = [];
            return;
        }
        
        // 计算边界框
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of allPoints) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }
        
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const mapCenter = new Vector(centerX, centerY);
        const mapRadius = Math.max(maxX - minX, maxY - minY) / 2;
        
        // 创建分类器
        const classifier = new LandUseClassifier(
            mapCenter,
            mapRadius,
            this._mainRoads,
            this._majorRoads,
            this._landUseConfig
        );
        
        // 分类
        this._landUseInfos = classifier.classifyLots(this._filteredLots);
    }
    
    /**
     * 设置道路数据用于分类
     */
    setRoadsForClassification(mainRoads: Vector[][], majorRoads: Vector[][]): void {
        this._mainRoads = mainRoads;
        this._majorRoads = majorRoads;
    }
    
    /**
     * 获取用地信息
     */
    get landUseInfos(): LandUseInfo[] {
        return this._landUseInfos;
    }
    
    /**
     * 获取用地类型配置
     */
    get landUseConfig(): Partial<LandUseConfig> {
        return this._landUseConfig;
    }
    
    /**
     * 设置用地类型配置
     */
    set landUseConfig(value: Partial<LandUseConfig>) {
        this._landUseConfig = value;
        // 如果启用了用地染色，重新分类
        if (this._enableLandUseColoring && this._filteredLots.length > 0) {
            this.classifyLandUse();
            this.redraw();
        }
    }
    
    /**
     * 更新特定用地类型的配置
     */
    updateLandUseTypeConfig(
        type: 'residential' | 'commercial' | 'industrial' | 'mixedUse' | 'public',
        config: Partial<{enabled: boolean; centerWeight: number; roadWeight: number; areaWeight: number; clusteringStrength: number}>
    ): void {
        if (!this._landUseConfig[type]) {
            this._landUseConfig[type] = {} as any;
        }
        Object.assign(this._landUseConfig[type], config);
        
        // 如果启用了用地染色，重新分类
        if (this._enableLandUseColoring && this._filteredLots.length > 0) {
            this.classifyLandUse();
            this.redraw();
        }
    }
    
    /**
     * 更新全局随机性参数
     */
    updateGlobalRandomness(value: number): void {
        this._landUseConfig.globalRandomness = value;
        
        // 如果启用了用地染色，重新分类
        if (this._enableLandUseColoring && this._filteredLots.length > 0) {
            this.classifyLandUse();
            this.redraw();
        }
    }
    
    /**
     * 启用/禁用用地染色
     */
    get enableLandUseColoring(): boolean {
        return this._enableLandUseColoring;
    }
    
    set enableLandUseColoring(value: boolean) {
        console.log('🎨 用地类型染色开关:', value);
        this._enableLandUseColoring = value;
        // 重新分类或清除
        if (value && this._filteredLots.length > 0) {
            console.log('🔄 开始对', this._filteredLots.length, '个地块进行分类...');
            this.classifyLandUse();
            const landUseTypes = this._landUseInfos.map(info => info.type);
            this._models = new BuildingModels(this._filteredLots, landUseTypes);
            console.log('✅ 用地分类完成，已更新建筑模型');
        } else {
            this._landUseInfos = [];
            this._models = new BuildingModels(this._filteredLots);
            if (!value) {
                console.log('❌ 用地类型染色已禁用');
            } else {
                console.log('⚠️ 无法启用用地染色：没有建筑地块（请先生成建筑）');
            }
        }
        this.redraw();
    }

    get density(): number {
        return this._density;
    }

    set density(v: number) {
        this._density = v;
        this.refilterLots();
    }
}