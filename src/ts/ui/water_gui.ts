import * as log from 'loglevel';
import CanvasWrapper from './canvas_wrapper';
import DomainController from './domain_controller';
import Util from '../util';
import FieldIntegrator from '../impl/integrator';
import {StreamlineParams} from '../impl/streamlines';
import {WaterParams} from '../impl/water_generator';
import WaterGenerator from '../impl/water_generator';
import Vector from '../vector';
import PolygonFinder from '../impl/polygon_finder';
import PolygonUtil from '../impl/polygon_util';
import RoadGUI from './road_gui';
import {NoiseParams} from '../impl/tensor_field';
import TensorField from '../impl/tensor_field';

/**
 * Handles generation of river and coastline
 */
export default class WaterGUI extends RoadGUI {
    protected streamlines: WaterGenerator;

    constructor(private tensorField: TensorField,
                protected params: WaterParams,
                integrator: FieldIntegrator,
                guiFolder: dat.GUI,
                closeTensorFolder: () => void,
                folderName: string,
                redraw: () => void) {
        super(params, integrator, guiFolder, closeTensorFolder, folderName, redraw);
        this.streamlines = new WaterGenerator(
            this.integrator, this.domainController.origin,
            this.domainController.worldDimensions,
            Object.assign({},this.params), this.tensorField);
    }

    initFolder(): WaterGUI {
    const folder = this.guiFolder.addFolder(this.folderName);
    folder.add({生成: () => this.generateRoads()}, '生成');
        
    const coastParamsFolder = folder.addFolder('海岸参数');
    coastParamsFolder.add(this.params.coastNoise, 'noiseEnabled').name('启用噪声');
    coastParamsFolder.add(this.params.coastNoise, 'noiseSize').name('噪声规模');
    coastParamsFolder.add(this.params.coastNoise, 'noiseAngle').name('噪声角度');
    const riverParamsFolder = folder.addFolder('河流参数');
    riverParamsFolder.add(this.params.riverNoise, 'noiseEnabled').name('启用噪声');
    riverParamsFolder.add(this.params.riverNoise, 'noiseSize').name('噪声规模');
    riverParamsFolder.add(this.params.riverNoise, 'noiseAngle').name('噪声角度');
        
    folder.add(this.params, 'simplifyTolerance').name('简化容差');
    const devParamsFolder = folder.addFolder('开发');
    this.addDevParamsToFolder(this.params, devParamsFolder);
        return this;
    }

    generateRoads(): Promise<void> {
        this.preGenerateCallback();

        this.domainController.zoom = this.domainController.zoom / Util.DRAW_INFLATE_AMOUNT;
        this.streamlines = new WaterGenerator(
            this.integrator, this.domainController.origin,
            this.domainController.worldDimensions,
            Object.assign({},this.params), this.tensorField);
        this.domainController.zoom = this.domainController.zoom * Util.DRAW_INFLATE_AMOUNT;

        this.streamlines.createCoast();
        this.streamlines.createRiver();
       
        this.closeTensorFolder();
        this.redraw();
        this.postGenerateCallback();
        return new Promise<void>(resolve => resolve());
    }

    /**
     * Secondary road runs along other side of river
     */
    get streamlinesWithSecondaryRoad(): Vector[][] {
        const withSecondary = this.streamlines.allStreamlinesSimple.slice();
        withSecondary.push(this.streamlines.riverSecondaryRoad);
        return withSecondary;
    }

    get river(): Vector[] {
        return this.streamlines.riverPolygon.map(v => this.domainController.worldToScreen(v.clone()));
    }

    get secondaryRiver(): Vector[] {
        return this.streamlines.riverSecondaryRoad.map(v => this.domainController.worldToScreen(v.clone()));
    }

    get coastline(): Vector[] {
        // Use unsimplified noisy streamline as coastline
        // Visual only, no road logic performed using this
        return this.streamlines.coastline.map(v => this.domainController.worldToScreen(v.clone()));
    }

    get seaPolygon(): Vector[] {
        return this.streamlines.seaPolygon.map(v => this.domainController.worldToScreen(v.clone()));
    }

    protected addDevParamsToFolder(params: StreamlineParams, folder: dat.GUI): void {
        folder.add(params, 'dsep').name('分离距离 (dsep)');
        folder.add(params, 'dtest').name('检测距离 (dtest)');
        folder.add(params, 'pathIterations').name('路径迭代次数');
        folder.add(params, 'seedTries').name('种子尝试次数');
        folder.add(params, 'dstep').name('步长 (dstep)');
        folder.add(params, 'dlookahead').name('前瞻距离 (dlookahead)');
        folder.add(params, 'dcirclejoin').name('圆形连接 (dcirclejoin)');
        folder.add(params, 'joinangle').name('连接角度');
    }
    
}
