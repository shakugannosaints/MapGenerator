import * as log from 'loglevel';
import Vector from '../vector';
import DomainController from './domain_controller';
import DragController from './drag_controller';

/**
 * 管理城市生成边界多边形
 * 支持用户通过点击添加顶点、拖拽顶点、删除顶点
 */
export default class CityBoundary {
    private _vertices: Vector[] = [];  // 世界坐标
    private _enabled: boolean = false;
    private domainController = DomainController.getInstance();
    private dragController: DragController;
    private deregisterCallbacks: (() => void)[] = [];
    private redraw: () => void;

    // 编辑模式：当前是否允许添加/删除顶点
    private _editMode: boolean = false;
    private readonly VERTEX_CLICK_RADIUS = 15;  // 屏幕像素

    constructor(dragController: DragController, redraw: () => void) {
        this.dragController = dragController;
        this.redraw = redraw;
        this.setupDefaultBoundary();
    }

    /**
     * 设置默认边界为当前视图的矩形
     */
    private setupDefaultBoundary(): void {
        const origin = this.domainController.origin;
        const dims = this.domainController.worldDimensions;
        const margin = 0.2; // 留20%边距
        const mx = dims.x * margin;
        const my = dims.y * margin;
        
        this._vertices = [
            origin.clone().add(new Vector(mx, my)),
            origin.clone().add(new Vector(dims.x - mx, my)),
            origin.clone().add(new Vector(dims.x - mx, dims.y - my)),
            origin.clone().add(new Vector(mx, dims.y - my)),
        ];
    }

    /**
     * 重置为当前视图的默认矩形
     */
    reset(): void {
        this.setupDefaultBoundary();
        this.updateDragHandles();
        this.redraw();
    }

    /**
     * 启用/禁用边界
     */
    set enabled(val: boolean) {
        this._enabled = val;
        if (val && this._editMode) {
            this.updateDragHandles();
        } else {
            this.clearDragHandles();
        }
        this.redraw();
    }

    get enabled(): boolean {
        return this._enabled;
    }

    /**
     * 进入/退出编辑模式
     */
    set editMode(val: boolean) {
        this._editMode = val;
        if (val && this._enabled) {
            // 编辑模式下注册顶点拖拽句柄
            this.updateDragHandles();
        } else {
            // 退出编辑模式时清除拖拽句柄
            this.clearDragHandles();
        }
        this.redraw();
    }

    get editMode(): boolean {
        return this._editMode;
    }

    /**
     * 获取顶点（世界坐标）
     */
    get vertices(): Vector[] {
        return this._vertices;
    }

    /**
     * 获取顶点（屏幕坐标，用于绘制）
     */
    get verticesScreen(): Vector[] {
        return this._vertices.map(v => this.domainController.worldToScreen(v.clone()));
    }

    /**
     * 点是否在边界内（世界坐标）
     * 使用射线法判断点是否在多边形内
     */
    contains(point: Vector): boolean {
        if (!this._enabled || this._vertices.length < 3) {
            return true;  // 边界未启用时，所有点都有效
        }

        const x = point.x;
        const y = point.y;
        let inside = false;

        for (let i = 0, j = this._vertices.length - 1; i < this._vertices.length; j = i++) {
            const xi = this._vertices[i].x;
            const yi = this._vertices[i].y;
            const xj = this._vertices[j].x;
            const yj = this._vertices[j].y;

            const intersect = ((yi > y) !== (yj > y)) && 
                             (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }

        return inside;
    }

    /**
     * 添加顶点（屏幕坐标点击位置）
     */
    addVertex(screenPos: Vector): void {
        if (!this._editMode) return;

        const worldPos = this.domainController.screenToWorld(screenPos.clone());
        
        // 检查是否点击在现有顶点附近（删除而不是添加）
        for (let i = 0; i < this._vertices.length; i++) {
            const vScreen = this.domainController.worldToScreen(this._vertices[i].clone());
            if (vScreen.distanceTo(screenPos) < this.VERTEX_CLICK_RADIUS) {
                // 点击现有顶点 -> 删除它（至少保留3个顶点）
                if (this._vertices.length > 3) {
                    this._vertices.splice(i, 1);
                    this.updateDragHandles();
                    this.redraw();
                }
                return;
            }
        }

        // 找到最近的边，在该边上插入新顶点
        let closestEdge = 0;
        let closestDist = Infinity;

        for (let i = 0; i < this._vertices.length; i++) {
            const v1 = this.domainController.worldToScreen(this._vertices[i].clone());
            const v2 = this.domainController.worldToScreen(this._vertices[(i + 1) % this._vertices.length].clone());
            const dist = this.pointToSegmentDistance(screenPos, v1, v2);
            if (dist < closestDist) {
                closestDist = dist;
                closestEdge = i;
            }
        }

        // 在该边之后插入新顶点
        this._vertices.splice(closestEdge + 1, 0, worldPos);
        this.updateDragHandles();
        this.redraw();
    }

    /**
     * 计算点到线段的距离
     */
    private pointToSegmentDistance(p: Vector, a: Vector, b: Vector): number {
        const ab = b.clone().sub(a);
        const ap = p.clone().sub(a);
        const proj = ap.dot(ab) / ab.lengthSq();
        
        if (proj < 0) return p.distanceTo(a);
        if (proj > 1) return p.distanceTo(b);
        
        const closest = a.clone().add(ab.multiplyScalar(proj));
        return p.distanceTo(closest);
    }

    /**
     * 更新所有顶点的拖拽句柄
     */
    private updateDragHandles(): void {
        this.clearDragHandles();

        if (!this._enabled || !this._editMode) return;

        for (let i = 0; i < this._vertices.length; i++) {
            const index = i;  // 闭包捕获
            const deregister = this.dragController.register(
                () => this._vertices[index].clone(),
                (delta: Vector) => {
                    this._vertices[index].add(delta);
                    this.redraw();
                },
                () => {}
            );
            this.deregisterCallbacks.push(deregister);
        }
    }

    /**
     * 清除所有拖拽句柄
     */
    private clearDragHandles(): void {
        for (const cb of this.deregisterCallbacks) {
            cb();
        }
        this.deregisterCallbacks = [];
    }

    /**
     * 获取边界的包围盒中心（用于采样优化）
     */
    getBoundingBoxCenter(): Vector {
        if (this._vertices.length === 0) {
            return this.domainController.origin.clone().add(
                this.domainController.worldDimensions.divideScalar(2)
            );
        }

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        for (const v of this._vertices) {
            if (v.x < minX) minX = v.x;
            if (v.x > maxX) maxX = v.x;
            if (v.y < minY) minY = v.y;
            if (v.y > maxY) maxY = v.y;
        }

        return new Vector((minX + maxX) / 2, (minY + maxY) / 2);
    }

    /**
     * 获取边界的包围盒尺寸
     */
    getBoundingBoxSize(): Vector {
        if (this._vertices.length === 0) {
            return this.domainController.worldDimensions.clone();
        }

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        for (const v of this._vertices) {
            if (v.x < minX) minX = v.x;
            if (v.x > maxX) maxX = v.x;
            if (v.y < minY) minY = v.y;
            if (v.y > maxY) maxY = v.y;
        }

        return new Vector(maxX - minX, maxY - minY);
    }
}
