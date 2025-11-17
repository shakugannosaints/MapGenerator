import * as log from 'loglevel';
import * as simplify from 'simplify-js';
import * as SimplexNoise from 'simplex-noise';
import Vector from '../vector';
import GridStorage from './grid_storage';
import FieldIntegrator from './integrator';

interface StreamlineIntegration {
    seed: Vector;
    originalDir: Vector;
    streamline: Vector[];
    previousDirection: Vector;
    previousPoint: Vector;
    valid: boolean;
}

// 边界检测函数类型
export type BoundaryChecker = (point: Vector) => boolean;

export interface StreamlineParams {
    [key: string]: any;
    dsep: number;  // Streamline seed separating distance
    dtest: number;  // Streamline integration separating distance
    dstep: number;  // Step size
    dcirclejoin: number;  // How far to look to join circles - (e.g. 2 x dstep)
    dlookahead: number;  // How far to look ahead to join up dangling
    joinangle: number;  // Angle to join roads in radians
    pathIterations: number;  // Path integration iteration limit
    seedTries: number;  // Max failed seeds
    simplifyTolerance: number;
    collideEarly: number;  // Chance of early collision 0-1
    
    // 真实性增强参数
    enablePathPerturbation: boolean;  // 启用路径扰动
    perturbationStrength: number;  // 扰动强度 (0-1)
    perturbationFrequency: number;  // 扰动频率 (噪声规模)
    perturbationOctaves: number;  // 噪声叠加层数
    
    enableTerrainInfluence: boolean;  // 启用地形影响
    terrainNoiseScale: number;  // 地形噪声规模
    terrainInfluenceStrength: number;  // 地形影响强度 (0-1)
    terrainSteepnessThreshold: number;  // 陡峭度阈值
    
    enableHistoricalLayers: boolean;  // 启用历史分层
    historicalLayerRadius: number;  // 老城区半径
    modernLayerStart: number;  // 现代区域起始半径
    oldCityPerturbation: number;  // 老城区扰动强度
    modernCityPerturbation: number;  // 现代区域扰动强度
    
    enableDirectionalBias: boolean;  // 启用方向偏好
    biasDirection: number;  // 偏好方向(弧度)
    biasStrength: number;  // 偏好强度 (0-1)
    biasNoiseScale: number;  // 偏好噪声规模
}

/**
 * Creates polylines that make up the roads by integrating the tensor field
 * See the paper 'Interactive Procedural Street Modeling' for a thorough explanation
 */
export default class StreamlineGenerator {
    protected readonly SEED_AT_ENDPOINTS = false;
    protected readonly NEAR_EDGE = 3;  // Sample near edge

    protected majorGrid: GridStorage;
    protected minorGrid: GridStorage;
    protected paramsSq: StreamlineParams;

    // 可选的边界检测函数
    protected boundaryChecker: BoundaryChecker | null = null;

    // How many samples to skip when checking streamline collision with itself
    protected nStreamlineStep: number;
    // How many samples to ignore backwards when checking streamline collision with itself
    protected nStreamlineLookBack: number;
    protected dcollideselfSq: number;

    protected candidateSeedsMajor: Vector[] = [];
    protected candidateSeedsMinor: Vector[] = [];

    protected streamlinesDone = true;
    protected resolve: () => void;
    protected lastStreamlineMajor = true;

    public allStreamlines: Vector[][] = [];
    public streamlinesMajor: Vector[][] = [];
    public streamlinesMinor: Vector[][] = [];
    public allStreamlinesSimple: Vector[][] = [];  // Reduced vertex count
    
    // 真实性增强系统
    protected perturbationNoise: SimplexNoise;
    protected terrainNoise: SimplexNoise;
    protected biasNoise: SimplexNoise;
    protected centerPoint: Vector;  // 用于历史分层的城市中心

    /**
     * Uses world-space coordinates
     */
    constructor(protected integrator: FieldIntegrator,
                protected origin: Vector,
                protected worldDimensions: Vector,
                protected params: StreamlineParams) {
        if (params.dstep > params.dsep) {
            log.error("STREAMLINE SAMPLE DISTANCE BIGGER THAN DSEP");
        }

        // Enforce test < sep
        params.dtest = Math.min(params.dtest, params.dsep);

        // Needs to be less than circlejoin
        this.dcollideselfSq = (params.dcirclejoin / 2) ** 2;
        this.nStreamlineStep = Math.floor(params.dcirclejoin / params.dstep);
        this.nStreamlineLookBack = 2 * this.nStreamlineStep;

        this.majorGrid = new GridStorage(this.worldDimensions, this.origin, params.dsep);
        this.minorGrid = new GridStorage(this.worldDimensions, this.origin, params.dsep);

        this.setParamsSq();
        
        // 初始化真实性增强系统
        this.perturbationNoise = new SimplexNoise();
        this.terrainNoise = new SimplexNoise();
        this.biasNoise = new SimplexNoise();
        this.centerPoint = new Vector(
            this.origin.x + this.worldDimensions.x / 2,
            this.origin.y + this.worldDimensions.y / 2
        );
    }

    clearStreamlines(): void {
        this.allStreamlinesSimple = [];
        this.streamlinesMajor = [];
        this.streamlinesMinor = [];
        this.allStreamlines = [];
    }

    /**
     * 设置边界检测函数
     */
    setBoundaryChecker(checker: BoundaryChecker | null): void {
        this.boundaryChecker = checker;
    }
    
    /**
     * 计算路径扰动角度
     * 返回扰动的弧度值
     */
    protected calculatePathPerturbation(point: Vector): number {
        if (!this.params.enablePathPerturbation) {
            return 0;
        }
        
        const scale = this.params.perturbationFrequency;
        let perturbation = 0;
        let amplitude = this.params.perturbationStrength;
        let frequency = 1;
        
        // 多层噪声叠加,产生更自然的效果
        for (let i = 0; i < this.params.perturbationOctaves; i++) {
            perturbation += this.perturbationNoise.noise2D(
                point.x / scale * frequency,
                point.y / scale * frequency
            ) * amplitude;
            
            amplitude *= 0.5;  // 每层振幅递减
            frequency *= 2;    // 每层频率递增
        }
        
        // 将噪声值(-1到1)映射到角度范围(-π/4 到 π/4)
        return perturbation * Math.PI / 4;
    }
    
    /**
     * 计算地形对路径的影响
     * 返回一个修正向量,使道路避开陡峭地形
     */
    protected calculateTerrainInfluence(point: Vector, direction: Vector): Vector {
        if (!this.params.enableTerrainInfluence) {
            return new Vector(0, 0);
        }
        
        const scale = this.params.terrainNoiseScale;
        
        // 采样当前点的地形高度
        const currentHeight = this.terrainNoise.noise2D(point.x / scale, point.y / scale);
        
        // 采样梯度方向的地形高度
        const sampleDistance = this.params.dstep * 0.5;
        const gradX = this.terrainNoise.noise2D(
            (point.x + sampleDistance) / scale,
            point.y / scale
        ) - currentHeight;
        const gradY = this.terrainNoise.noise2D(
            point.x / scale,
            (point.y + sampleDistance) / scale
        ) - currentHeight;
        
        // 地形梯度向量(指向上坡方向)
        const gradient = new Vector(-gradX, -gradY);
        
        // 如果坡度超过阈值,让道路偏离梯度方向
        if (gradient.length() > this.params.terrainSteepnessThreshold) {
            // 道路倾向于沿着等高线(垂直于梯度)
            const perpendicular = new Vector(-gradient.y, gradient.x);
            perpendicular.setLength(this.params.terrainInfluenceStrength);
            return perpendicular;
        }
        
        return new Vector(0, 0);
    }
    
    /**
     * 根据距离中心的距离计算历史层次的扰动强度
     */
    protected getHistoricalPerturbationStrength(point: Vector): number {
        if (!this.params.enableHistoricalLayers) {
            return 1.0;
        }
        
        const distanceFromCenter = point.distanceTo(this.centerPoint);
        
        // 老城区:高扰动
        if (distanceFromCenter < this.params.historicalLayerRadius) {
            return this.params.oldCityPerturbation;
        }
        
        // 现代区域:低扰动
        if (distanceFromCenter > this.params.modernLayerStart) {
            return this.params.modernCityPerturbation;
        }
        
        // 过渡区域:线性插值
        const t = (distanceFromCenter - this.params.historicalLayerRadius) / 
                  (this.params.modernLayerStart - this.params.historicalLayerRadius);
        return this.params.oldCityPerturbation * (1 - t) + this.params.modernCityPerturbation * t;
    }
    
    /**
     * 计算方向偏好影响
     */
    protected calculateDirectionalBias(point: Vector): number {
        if (!this.params.enableDirectionalBias) {
            return 0;
        }
        
        // 使用噪声场来创建区域性的方向偏好
        const scale = this.params.biasNoiseScale;
        const noiseValue = this.biasNoise.noise2D(point.x / scale, point.y / scale);
        
        // 噪声值影响偏好强度
        const effectiveStrength = this.params.biasStrength * (noiseValue * 0.5 + 0.5);
        
        return this.params.biasDirection * effectiveStrength;
    }
    
    /**
     * 应用所有真实性增强效果到方向向量
     */
    protected applyRealismEnhancements(point: Vector, direction: Vector): Vector {
        let enhancedDirection = direction.clone();
        
        // 1. 基础路径扰动
        let perturbationAngle = this.calculatePathPerturbation(point);
        
        // 2. 历史层次影响扰动强度
        const historicalStrength = this.getHistoricalPerturbationStrength(point);
        perturbationAngle *= historicalStrength;
        
        // 3. 方向偏好
        perturbationAngle += this.calculateDirectionalBias(point);
        
        // 应用旋转
        if (perturbationAngle !== 0) {
            const cos = Math.cos(perturbationAngle);
            const sin = Math.sin(perturbationAngle);
            const x = enhancedDirection.x * cos - enhancedDirection.y * sin;
            const y = enhancedDirection.x * sin + enhancedDirection.y * cos;
            enhancedDirection = new Vector(x, y);
        }
        
        // 4. 地形影响
        const terrainInfluence = this.calculateTerrainInfluence(point, enhancedDirection);
        enhancedDirection.add(terrainInfluence);
        
        // 归一化并恢复原长度
        const originalLength = direction.length();
        enhancedDirection.setLength(originalLength);
        
        return enhancedDirection;
    }

    /**
     * Edits streamlines
     */
    joinDanglingStreamlines(): void {
        // TODO do in update method
        for (const major of [true, false]) {
            for (const streamline of this.streamlines(major)) {
                // Ignore circles
                if (streamline[0].equals(streamline[streamline.length - 1])) {
                    continue;
                }

                const newStart = this.getBestNextPoint(streamline[0], streamline[4], streamline)
                if (newStart !== null) {
                    for (const p of this.pointsBetween(streamline[0], newStart, this.params.dstep)) {
                        streamline.unshift(p);
                        this.grid(major).addSample(p);
                    }
                }

                const newEnd = this.getBestNextPoint(streamline[streamline.length - 1], streamline[streamline.length - 4], streamline);
                if (newEnd !== null) {
                    for (const p of this.pointsBetween(streamline[streamline.length - 1], newEnd, this.params.dstep)) {
                        streamline.push(p);
                        this.grid(major).addSample(p);
                    }
                }
            }
        }

        // Reset simplified streamlines
        this.allStreamlinesSimple = [];
        for (const s of this.allStreamlines) {
            this.allStreamlinesSimple.push(this.simplifyStreamline(s));
        }
    }

    /**
     * Returns array of points from v1 to v2 such that they are separated by at most dsep
     * not including v1
     */
    pointsBetween(v1: Vector, v2: Vector, dstep: number): Vector[] {
        const d = v1.distanceTo(v2);
        const nPoints = Math.floor(d / dstep);
        if (nPoints === 0) return [];

        const stepVector = v2.clone().sub(v1);

        const out = [];
        let i = 1;
        let next = v1.clone().add(stepVector.clone().multiplyScalar(i / nPoints));
        for (i = 1; i <= nPoints; i++) {
            if (this.integrator.integrate(next, true).lengthSq() > 0.001) {  // Test for degenerate point
                out.push(next);
            } else {
                return out;
            }
            next = v1.clone().add(stepVector.clone().multiplyScalar(i / nPoints));
        }
        return out;
    }


    /**
     * Gets next best point to join streamline
     * returns null if there are no good candidates
     */
    getBestNextPoint(point: Vector, previousPoint: Vector, streamline: Vector[]): Vector {
        const nearbyPoints = this.majorGrid.getNearbyPoints(point, this.params.dlookahead);
        nearbyPoints.push(...this.minorGrid.getNearbyPoints(point, this.params.dlookahead));
        const direction = point.clone().sub(previousPoint);

        let closestSample = null;
        let closestDistance = Infinity;

        for (const sample of nearbyPoints) {
            if (!sample.equals(point) && !sample.equals(previousPoint)) {// && !streamline.includes(sample)) {
                const differenceVector = sample.clone().sub(point);
                if (differenceVector.dot(direction) < 0) {
                    // Backwards
                    continue;
                }
                
                // Acute angle between vectors (agnostic of CW, ACW)
                const distanceToSample = point.distanceToSquared(sample);
                if (distanceToSample < 2 * this.paramsSq.dstep) {
                    closestSample = sample;
                    break;
                }
                const angleBetween = Math.abs(Vector.angleBetween(direction, differenceVector));

                // Filter by angle
                if (angleBetween < this.params.joinangle && distanceToSample < closestDistance) {
                    closestDistance = distanceToSample;
                    closestSample = sample;
                }
            }
        }

        // TODO is reimplement simplify-js to preserve intersection points
        //  - this is the primary reason polygons aren't found
        // If trying to find intersections in the simplified graph
        // prevent ends getting pulled away from simplified lines
        if (closestSample !== null) {
            closestSample = closestSample.clone().add(direction.setLength(this.params.simplifyTolerance * 4));
        }

        return closestSample;
    }


    /**
     * Assumes s has already generated
     */
    addExistingStreamlines(s: StreamlineGenerator): void {
        this.majorGrid.addAll(s.majorGrid);
        this.minorGrid.addAll(s.minorGrid);
    }

    setGrid(s: StreamlineGenerator): void {
        this.majorGrid = s.majorGrid;
        this.minorGrid = s.minorGrid;
    }

    /**
     * returns true if state updates
     */
    update(): boolean {
        if (!this.streamlinesDone) {
            this.lastStreamlineMajor = !this.lastStreamlineMajor;
            if (!this.createStreamline(this.lastStreamlineMajor)) {
                this.streamlinesDone = true;
                this.resolve();
            }
            return true;
        }

        return false;
    }

    /**
     * All at once - will freeze if dsep small
     */
    async createAllStreamlines(animate=false): Promise<void> {
        return new Promise<void>(resolve => {
            this.resolve = resolve
            this.streamlinesDone = false;

            if (!animate) {
                let major = true;
                while (this.createStreamline(major)) {
                    major = !major;
                }
            }
        }).then(() => this.joinDanglingStreamlines());
    }

    protected simplifyStreamline(streamline: Vector[]): Vector[] {
        const simplified = [];
        for (const point of simplify(streamline, this.params.simplifyTolerance)) {
            simplified.push(new Vector(point.x, point.y));
        }
        return simplified;
    }

    /**
     * Finds seed and creates a streamline from that point
     * Pushes new candidate seeds to queue
     * @return {Vector[]} returns false if seed isn't found within params.seedTries
     */
    protected createStreamline(major: boolean): boolean {
        const seed = this.getSeed(major);
        if (seed === null) {
            return false;
        }
        const streamline = this.integrateStreamline(seed, major);
        if (this.validStreamline(streamline)) {
            this.grid(major).addPolyline(streamline);
            this.streamlines(major).push(streamline);
            this.allStreamlines.push(streamline);

            this.allStreamlinesSimple.push(this.simplifyStreamline(streamline));

            // Add candidate seeds
            if (!streamline[0].equals(streamline[streamline.length - 1])) {
                this.candidateSeeds(!major).push(streamline[0]);
                this.candidateSeeds(!major).push(streamline[streamline.length - 1]);
            }
        }

        return true;
    }

    protected validStreamline(s: Vector[]): boolean {
        return s.length > 5;
    } 

    protected setParamsSq(): void {
        this.paramsSq = Object.assign({}, this.params);
        for (const p in this.paramsSq) {
            if (typeof this.paramsSq[p] === "number") {
                this.paramsSq[p] *= this.paramsSq[p];
            }
        }
    }

    protected samplePoint(): Vector {
        // 如果有边界检测器，在边界包围盒内采样
        if (this.boundaryChecker) {
            // 简单策略：在整个世界范围采样，依赖 isValidSample 过滤
            // 更优化的方法是获取边界包围盒，但需要额外接口
        }
        return new Vector(
            Math.random() * this.worldDimensions.x,
            Math.random() * this.worldDimensions.y)
            .add(this.origin);
    }
 
    /**
     * Tries this.candidateSeeds first, then samples using this.samplePoint
     */
    protected getSeed(major: boolean): Vector {
        // Candidate seeds first
        if (this.SEED_AT_ENDPOINTS && this.candidateSeeds(major).length > 0) {
            while (this.candidateSeeds(major).length > 0) {
                const seed = this.candidateSeeds(major).pop();
                if (this.isValidSample(major, seed, this.paramsSq.dsep)) {
                    return seed;
                }
            }
        }

        let seed = this.samplePoint();
        let i = 0;
        while (!this.isValidSample(major, seed, this.paramsSq.dsep)) {
            if (i >= this.params.seedTries) {
                return null;
            }
            seed = this.samplePoint();
            i++;
        }

        return seed;
    }

    protected isValidSample(major: boolean, point: Vector, dSq: number, bothGrids=false): boolean {
        // dSq = dSq * point.distanceToSquared(Vector.zeroVector());
        let gridValid = this.grid(major).isValidSample(point, dSq);
        if (bothGrids) {
            gridValid = gridValid && this.grid(!major).isValidSample(point, dSq);
        }
        // 检查是否在自定义边界内
        if (this.boundaryChecker && !this.boundaryChecker(point)) {
            return false;
        }
        return this.integrator.onLand(point) && gridValid;
    }

    protected candidateSeeds(major: boolean): Vector[] {
        return major ? this.candidateSeedsMajor : this.candidateSeedsMinor;
    }

    protected streamlines(major: boolean): Vector[][] {
        return major ? this.streamlinesMajor : this.streamlinesMinor;
    }

    protected grid(major: boolean): GridStorage {
        return major ? this.majorGrid : this.minorGrid;
    }

    protected pointInBounds(v: Vector): boolean {
        return (v.x >= this.origin.x
            && v.y >= this.origin.y
            && v.x < this.worldDimensions.x + this.origin.x
            && v.y < this.worldDimensions.y + this.origin.y
        );
    }

    /**
     * Didn't end up using - bit expensive, used streamlineTurned instead
     * Stops spirals from forming
     * uses 0.5 dcirclejoin so that circles are still joined up
     * testSample is candidate to pushed on end of streamlineForwards
     * returns true if streamline collides with itself
     */
    protected doesStreamlineCollideSelf(testSample: Vector, streamlineForwards: Vector[], streamlineBackwards: Vector[]): boolean {
        // Streamline long enough
        if (streamlineForwards.length > this.nStreamlineLookBack) {
            // Forwards check
            for (let i = 0; i < streamlineForwards.length - this.nStreamlineLookBack; i += this.nStreamlineStep) {
                if (testSample.distanceToSquared(streamlineForwards[i]) < this.dcollideselfSq) {
                    return true;
                }
            }

            // Backwards check
            for (let i = 0; i < streamlineBackwards.length; i += this.nStreamlineStep) {
                if (testSample.distanceToSquared(streamlineBackwards[i]) < this.dcollideselfSq) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Tests whether streamline has turned through greater than 180 degrees
     */
    protected streamlineTurned(seed: Vector, originalDir: Vector, point: Vector, direction: Vector): boolean {
        if (originalDir.dot(direction) < 0) {
            // TODO optimise
            const perpendicularVector = new Vector(originalDir.y, -originalDir.x);
            const isLeft = point.clone().sub(seed).dot(perpendicularVector) < 0;
            const directionUp = direction.dot(perpendicularVector) > 0;
            return isLeft === directionUp;
        }

        return false;
    }

    /**
     * // TODO this doesn't work well - consider something disallowing one direction (F/B) to turn more than 180 deg
     * One step of the streamline integration process
     */
    protected streamlineIntegrationStep(params: StreamlineIntegration, major: boolean, collideBoth: boolean): void {
        if (params.valid) {
            params.streamline.push(params.previousPoint);
            let nextDirection = this.integrator.integrate(params.previousPoint, major);

            // Stop at degenerate point
            if (nextDirection.lengthSq() < 0.01) {
                params.valid = false;
                return;
            }

            // Make sure we travel in the same direction
            if (nextDirection.dot(params.previousDirection) < 0) {
                nextDirection.negate();
            }
            
            // === 应用真实性增强 ===
            nextDirection = this.applyRealismEnhancements(params.previousPoint, nextDirection);

            const nextPoint = params.previousPoint.clone().add(nextDirection);

            // Visualise stopping points
            // if (this.streamlineTurned(params.seed, params.originalDir, nextPoint, nextDirection)) {
            //     params.valid = false;
            //     params.streamline.push(Vector.zeroVector());
            // }

            if (this.pointInBounds(nextPoint)
                && this.isValidSample(major, nextPoint, this.paramsSq.dtest, collideBoth)
                && !this.streamlineTurned(params.seed, params.originalDir, nextPoint, nextDirection)) {
                params.previousPoint = nextPoint;
                params.previousDirection = nextDirection;
            } else {
                // One more step
                params.streamline.push(nextPoint);
                params.valid = false;
            }
        }
    }

    /**
     * By simultaneously integrating in both directions we reduce the impact of circles not joining
     * up as the error matches at the join
     */
    protected integrateStreamline(seed: Vector, major: boolean): Vector[] {
        let count = 0;
        let pointsEscaped = false;  // True once two integration fronts have moved dlookahead away

        // Whether or not to test validity using both grid storages
        // (Collide with both major and minor)
        const collideBoth = Math.random() < this.params.collideEarly;

        const d = this.integrator.integrate(seed, major);

        const forwardParams: StreamlineIntegration = {
            seed: seed,
            originalDir: d,
            streamline: [seed],
            previousDirection: d,
            previousPoint: seed.clone().add(d),
            valid: true,
        }

        forwardParams.valid = this.pointInBounds(forwardParams.previousPoint);

        const negD = d.clone().negate();
        const backwardParams: StreamlineIntegration = {
            seed: seed,
            originalDir: negD,
            streamline: [],
            previousDirection: negD,
            previousPoint: seed.clone().add(negD),
            valid: true,
        }

        backwardParams.valid = this.pointInBounds(backwardParams.previousPoint);

        while (count < this.params.pathIterations && (forwardParams.valid || backwardParams.valid)) {
            this.streamlineIntegrationStep(forwardParams, major, collideBoth);
            this.streamlineIntegrationStep(backwardParams, major, collideBoth);

            // Join up circles
            const sqDistanceBetweenPoints = forwardParams.previousPoint.distanceToSquared(backwardParams.previousPoint);

            if (!pointsEscaped && sqDistanceBetweenPoints > this.paramsSq.dcirclejoin) {
                pointsEscaped = true;
            }

            if (pointsEscaped && sqDistanceBetweenPoints <= this.paramsSq.dcirclejoin) {
                forwardParams.streamline.push(forwardParams.previousPoint);
                forwardParams.streamline.push(backwardParams.previousPoint);
                backwardParams.streamline.push(backwardParams.previousPoint);
                break;
            }

            count++;
        }

        backwardParams.streamline.reverse().push(...forwardParams.streamline);
        return backwardParams.streamline;
    }
}
