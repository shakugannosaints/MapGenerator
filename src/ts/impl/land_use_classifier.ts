import Vector from '../vector';
import PolygonUtil from '../impl/polygon_util';

/**
 * 用地类型枚举
 */
export enum LandUseType {
    RESIDENTIAL = 'residential',      // 住宅
    COMMERCIAL = 'commercial',        // 商业
    INDUSTRIAL = 'industrial',        // 工业
    MIXED_USE = 'mixed_use',         // 混合用地
    PUBLIC = 'public',               // 公共设施
}

/**
 * 单个用地类型的配置
 */
export interface LandUseTypeConfig {
    enabled: boolean;           // 是否启用该类型
    centerWeight: number;       // 距离中心的权重 (0-1)
    roadWeight: number;         // 距离道路的权重 (0-1)
    areaWeight: number;         // 地块面积的权重 (0-1)
    clusteringStrength: number; // 聚类强度 (0-1)
}

/**
 * 用地分类配置参数
 */
export interface LandUseConfig {
    globalRandomness: number;   // 全局随机性因子 (0-1)
    
    // 各类型的独立配置
    residential: LandUseTypeConfig;
    commercial: LandUseTypeConfig;
    industrial: LandUseTypeConfig;
    mixedUse: LandUseTypeConfig;
    public: LandUseTypeConfig;
}

/**
 * 用地信息
 */
export interface LandUseInfo {
    type: LandUseType;
    polygon: Vector[];
    centroid: Vector;
    area: number;
}

/**
 * 智能用地分类器
 * 基于多种因素自动分配用地类型，模拟真实城市规划
 */
export default class LandUseClassifier {
    private config: LandUseConfig = {
        globalRandomness: 0.2,
        residential: {
            enabled: true,
            centerWeight: 0.4,
            roadWeight: 0.3,
            areaWeight: 0.2,
            clusteringStrength: 0.5
        },
        commercial: {
            enabled: true,
            centerWeight: 0.5,
            roadWeight: 0.4,
            areaWeight: 0.2,
            clusteringStrength: 0.6
        },
        industrial: {
            enabled: true,
            centerWeight: 0.4,
            roadWeight: 0.2,
            areaWeight: 0.4,
            clusteringStrength: 0.5
        },
        mixedUse: {
            enabled: true,
            centerWeight: 0.4,
            roadWeight: 0.3,
            areaWeight: 0.2,
            clusteringStrength: 0.4
        },
        public: {
            enabled: true,
            centerWeight: 0.3,
            roadWeight: 0.4,
            areaWeight: 0.3,
            clusteringStrength: 0.3
        }
    };

    private mapCenter: Vector;
    private mapRadius: number;
    private mainRoads: Vector[][] = [];
    private majorRoads: Vector[][] = [];
    
    constructor(
        mapCenter: Vector,
        mapRadius: number,
        mainRoads: Vector[][],
        majorRoads: Vector[][],
        config?: Partial<LandUseConfig>
    ) {
        this.mapCenter = mapCenter;
        this.mapRadius = mapRadius;
        this.mainRoads = mainRoads;
        this.majorRoads = majorRoads;
        
        if (config) {
            this.config = { ...this.config, ...config };
        }
    }

    /**
     * 分类所有地块
     */
    classifyLots(lots: Vector[][]): LandUseInfo[] {
        const landUseInfos: LandUseInfo[] = lots.map(polygon => {
            const centroid = this.calculateCentroid(polygon);
            const area = PolygonUtil.calcPolygonArea(polygon);
            
            return {
                type: LandUseType.RESIDENTIAL, // 默认值，稍后会被更新
                polygon,
                centroid,
                area,
            };
        });

        // 第一遍：基于独立因素分类
        for (const info of landUseInfos) {
            info.type = this.classifyLot(info);
        }

        // 第二遍：应用邻近聚类效应（检查是否有任何类型启用了聚类）
        const hasClustering = this.config.residential.clusteringStrength > 0 ||
                              this.config.commercial.clusteringStrength > 0 ||
                              this.config.industrial.clusteringStrength > 0 ||
                              this.config.mixedUse.clusteringStrength > 0 ||
                              this.config.public.clusteringStrength > 0;
        
        if (hasClustering) {
            this.applyClustering(landUseInfos);
        }

        // 输出统计信息
        const stats: Record<LandUseType, number> = {
            [LandUseType.RESIDENTIAL]: 0,
            [LandUseType.COMMERCIAL]: 0,
            [LandUseType.INDUSTRIAL]: 0,
            [LandUseType.MIXED_USE]: 0,
            [LandUseType.PUBLIC]: 0,
        };
        
        for (const info of landUseInfos) {
            stats[info.type]++;
        }
        
        console.log('🏙️ 用地类型分类完成:', {
            总数: landUseInfos.length,
            住宅: stats[LandUseType.RESIDENTIAL],
            商业: stats[LandUseType.COMMERCIAL],
            工业: stats[LandUseType.INDUSTRIAL],
            混合用地: stats[LandUseType.MIXED_USE],
            公共设施: stats[LandUseType.PUBLIC]
        });

        return landUseInfos;
    }

    /**
     * 基于多因素对单个地块分类
     */
    private classifyLot(info: LandUseInfo): LandUseType {
        const scores: Record<LandUseType, number> = {
            [LandUseType.RESIDENTIAL]: 0,
            [LandUseType.COMMERCIAL]: 0,
            [LandUseType.INDUSTRIAL]: 0,
            [LandUseType.MIXED_USE]: 0,
            [LandUseType.PUBLIC]: 0,
        };

        // 获取启用的类型
        const enabledTypes: LandUseType[] = [];
        if (this.config.residential.enabled) enabledTypes.push(LandUseType.RESIDENTIAL);
        if (this.config.commercial.enabled) enabledTypes.push(LandUseType.COMMERCIAL);
        if (this.config.industrial.enabled) enabledTypes.push(LandUseType.INDUSTRIAL);
        if (this.config.mixedUse.enabled) enabledTypes.push(LandUseType.MIXED_USE);
        if (this.config.public.enabled) enabledTypes.push(LandUseType.PUBLIC);

        // 如果没有启用的类型，默认返回住宅
        if (enabledTypes.length === 0) {
            return LandUseType.RESIDENTIAL;
        }

        // 因素1：距离中心的距离
        const distToCenter = info.centroid.distanceTo(this.mapCenter) / this.mapRadius;
        
        // 商业区：中心区域
        if (this.config.commercial.enabled && distToCenter < 0.3) {
            scores[LandUseType.COMMERCIAL] += this.config.commercial.centerWeight * (1 - distToCenter / 0.3);
        }
        
        // 混合用地：中心和中间区域
        if (this.config.mixedUse.enabled) {
            if (distToCenter < 0.3) {
                scores[LandUseType.MIXED_USE] += this.config.mixedUse.centerWeight * 0.5;
            } else if (distToCenter < 0.7) {
                scores[LandUseType.MIXED_USE] += this.config.mixedUse.centerWeight * 0.3;
            }
        }
        
        // 住宅区：中间区域
        if (this.config.residential.enabled && distToCenter >= 0.3 && distToCenter < 0.7) {
            const factor = (distToCenter - 0.3) / 0.4;
            scores[LandUseType.RESIDENTIAL] += this.config.residential.centerWeight * (1 - factor);
        }
        
        // 工业区：外围区域
        if (this.config.industrial.enabled && distToCenter >= 0.7) {
            const factor = (distToCenter - 0.7) / 0.3;
            scores[LandUseType.INDUSTRIAL] += this.config.industrial.centerWeight * factor;
        }
        
        // 住宅区：外围也可能有
        if (this.config.residential.enabled && distToCenter >= 0.7) {
            const factor = (distToCenter - 0.7) / 0.3;
            scores[LandUseType.RESIDENTIAL] += this.config.residential.centerWeight * (1 - factor) * 0.5;
        }

        // 因素2：距离主干道的距离
        const distToMainRoad = this.calculateDistanceToRoads(info.centroid, this.mainRoads);
        const distToMajorRoad = this.calculateDistanceToRoads(info.centroid, this.majorRoads);
        
        // 靠近主干道的更可能是商业或公共设施
        if (distToMainRoad < 50) {
            if (this.config.commercial.enabled) {
                scores[LandUseType.COMMERCIAL] += this.config.commercial.roadWeight * (1 - distToMainRoad / 50);
            }
            if (this.config.public.enabled) {
                scores[LandUseType.PUBLIC] += this.config.public.roadWeight * (1 - distToMainRoad / 50) * 0.5;
            }
        }
        
        // 靠近主要道路的可能是混合用地
        if (this.config.mixedUse.enabled && distToMajorRoad < 30) {
            scores[LandUseType.MIXED_USE] += this.config.mixedUse.roadWeight * (1 - distToMajorRoad / 30) * 0.5;
        }

        // 因素3：地块面积
        const normalizedArea = Math.min(1, info.area / 500); // 500为参考面积
        
        // 大地块更可能是工业或公共设施
        if (normalizedArea > 0.7) {
            if (this.config.industrial.enabled) {
                scores[LandUseType.INDUSTRIAL] += this.config.industrial.areaWeight * normalizedArea;
            }
            if (this.config.public.enabled) {
                scores[LandUseType.PUBLIC] += this.config.public.areaWeight * normalizedArea * 0.5;
            }
        } 
        // 中等地块更可能是住宅或混合用地
        else if (normalizedArea > 0.3) {
            if (this.config.residential.enabled) {
                scores[LandUseType.RESIDENTIAL] += this.config.residential.areaWeight * (1 - normalizedArea);
            }
            if (this.config.mixedUse.enabled) {
                scores[LandUseType.MIXED_USE] += this.config.mixedUse.areaWeight * 0.3;
            }
        } 
        // 小地块主要是住宅或商业
        else {
            if (this.config.residential.enabled) {
                scores[LandUseType.RESIDENTIAL] += this.config.residential.areaWeight * (1 - normalizedArea);
            }
            if (this.config.commercial.enabled) {
                scores[LandUseType.COMMERCIAL] += this.config.commercial.areaWeight * 0.2;
            }
        }

        // 添加随机性
        for (const type of enabledTypes) {
            scores[type] += Math.random() * this.config.globalRandomness;
        }

        // 只在启用的类型中选择
        return this.getMaxScoreType(scores, enabledTypes);
    }

    /**
     * 应用邻近聚类效应
     * 相邻地块倾向于具有相同的用地类型
     */
    private applyClustering(infos: LandUseInfo[]): void {
        const iterations = 2; // 聚类迭代次数
        
        // 获取每种类型的聚类强度
        const clusteringStrengths: Record<LandUseType, number> = {
            [LandUseType.RESIDENTIAL]: this.config.residential.clusteringStrength,
            [LandUseType.COMMERCIAL]: this.config.commercial.clusteringStrength,
            [LandUseType.INDUSTRIAL]: this.config.industrial.clusteringStrength,
            [LandUseType.MIXED_USE]: this.config.mixedUse.clusteringStrength,
            [LandUseType.PUBLIC]: this.config.public.clusteringStrength,
        };
        
        for (let iter = 0; iter < iterations; iter++) {
            const newTypes = [...infos.map(info => info.type)];
            
            for (let i = 0; i < infos.length; i++) {
                const info = infos[i];
                const neighbors = this.findNeighbors(info, infos);
                
                if (neighbors.length === 0) continue;
                
                // 统计邻居的类型
                const typeCounts = new Map<LandUseType, number>();
                for (const neighbor of neighbors) {
                    const count = typeCounts.get(neighbor.type) || 0;
                    typeCounts.set(neighbor.type, count + 1);
                }
                
                // 如果大多数邻居是同一类型，则考虑改变当前地块类型
                for (const [type, count] of typeCounts.entries()) {
                    const strength = clusteringStrengths[type];
                    if (count >= neighbors.length * 0.6 && Math.random() < strength) {
                        newTypes[i] = type;
                        break;
                    }
                }
            }
            
            // 应用新类型
            for (let i = 0; i < infos.length; i++) {
                infos[i].type = newTypes[i];
            }
        }
    }

    /**
     * 查找邻近地块
     */
    private findNeighbors(info: LandUseInfo, allInfos: LandUseInfo[], maxDistance: number = 100): LandUseInfo[] {
        const neighbors: LandUseInfo[] = [];
        
        for (const other of allInfos) {
            if (other === info) continue;
            
            const distance = info.centroid.distanceTo(other.centroid);
            if (distance < maxDistance) {
                neighbors.push(other);
            }
        }
        
        return neighbors;
    }

    /**
     * 计算点到道路的最小距离
     */
    private calculateDistanceToRoads(point: Vector, roads: Vector[][]): number {
        if (roads.length === 0) return Infinity;
        
        let minDist = Infinity;
        
        for (const road of roads) {
            for (let i = 0; i < road.length - 1; i++) {
                const dist = this.pointToSegmentDistance(point, road[i], road[i + 1]);
                minDist = Math.min(minDist, dist);
            }
        }
        
        return minDist;
    }

    /**
     * 点到线段的距离
     */
    private pointToSegmentDistance(point: Vector, segStart: Vector, segEnd: Vector): number {
        const dx = segEnd.x - segStart.x;
        const dy = segEnd.y - segStart.y;
        const lengthSquared = dx * dx + dy * dy;
        
        if (lengthSquared === 0) {
            return point.distanceTo(segStart);
        }
        
        let t = ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / lengthSquared;
        t = Math.max(0, Math.min(1, t));
        
        const projection = new Vector(
            segStart.x + t * dx,
            segStart.y + t * dy
        );
        
        return point.distanceTo(projection);
    }

    /**
     * 计算多边形重心
     */
    private calculateCentroid(polygon: Vector[]): Vector {
        if (polygon.length === 0) return new Vector(0, 0);
        
        let sumX = 0;
        let sumY = 0;
        
        for (const v of polygon) {
            sumX += v.x;
            sumY += v.y;
        }
        
        return new Vector(sumX / polygon.length, sumY / polygon.length);
    }

    /**
     * 获取得分最高的类型
     */
    private getMaxScoreType(scores: Record<LandUseType, number>, enabledTypes?: LandUseType[]): LandUseType {
        let maxScore = -Infinity;
        let maxType = LandUseType.RESIDENTIAL;
        
        // 如果提供了启用类型列表，只在这些类型中选择
        const typesToCheck = enabledTypes || Object.keys(scores) as LandUseType[];
        
        for (const type of typesToCheck) {
            if (scores[type] > maxScore) {
                maxScore = scores[type];
                maxType = type;
            }
        }
        
        return maxType;
    }

    /**
     * 更新配置
     */
    updateConfig(config: Partial<LandUseConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * 获取用地类型的显示名称（中文）
     */
    static getLandUseTypeName(type: LandUseType): string {
        const names: Record<LandUseType, string> = {
            [LandUseType.RESIDENTIAL]: '住宅',
            [LandUseType.COMMERCIAL]: '商业',
            [LandUseType.INDUSTRIAL]: '工业',
            [LandUseType.MIXED_USE]: '混合用地',
            [LandUseType.PUBLIC]: '公共设施',
        };
        return names[type];
    }
}
