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

        const devParamsFolder = paramsFolder.addFolder('开发');
        this.addDevParamsToFolder(this.params, devParamsFolder);
        return this;
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
