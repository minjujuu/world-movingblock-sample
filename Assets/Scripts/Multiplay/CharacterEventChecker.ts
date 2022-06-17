import { Vector3, Collider, ControllerColliderHit, GameObject, Renderer } from 'UnityEngine';
import { ZepetoScriptBehaviour } from 'ZEPETO.Script'
import BlockMultiplay from './BlockMultiplay';
import { Physics, RaycastHit } from "UnityEngine";
import MultiMovingBlock from './MultiMovingBlock';
import MultiOrbitingBlock from './MultiOrbitingBlock';

export default class CharacterEventChecker extends ZepetoScriptBehaviour {

    private blockMultiplay: BlockMultiplay;
    private prevLandedPlatform: GameObject;
    private prevLandedBlock: GameObject;
    private isJumpingFromPlatformToBlock: boolean; // 현재 캐릭터가 플랫폼에서 블록으로 점프 중인지
    private canCheckMovingFromPlatformToBlock: boolean; // 플랫폼에서 블록으로 점프하는 걸 감지할 수 있는 상태인지 (중복 감지 방지)
    private jumpPosition: Vector3 = Vector3.zero;
    private platformRenderer: Renderer;

    Start() {
        this.blockMultiplay = BlockMultiplay.GetInstance();
        this.prevLandedPlatform = null;
        this.prevLandedBlock = null;
        this.canCheckMovingFromPlatformToBlock = true;
        this.isJumpingFromPlatformToBlock = false;
    }

    Update() {
        // 바닥방향으로 쏜 Ray에 닿은 물체가 FallCheckTrigger인 게 확인되면 서버로 메시지를 전송
        // - 플랫폼 <-> 무빙블록 간 이동을 감지하기 위해
        // - 다른 플랫폼에 도달하기 전까지는 또 보내면 안되므로 isAnotherPlatform 변수 이용
        let ref = $ref<RaycastHit>();
        if (Physics.Raycast(this.transform.position, Vector3.down, ref, 1000)) {
            let hitInfo = $unref(ref);

            if (hitInfo.collider.tag == "FallCheckTrigger") {

                this.prevLandedPlatform = null;
                // 또 다른 플랫폼에서 출발한 경우 
                if (false == this.isFirstLandingOnPlatform)
                    this.isFirstLandingOnPlatform = true;

                //  플랫폼 -> 무빙블록 
                if (this.canCheckMovingFromPlatformToBlock) {
                    this.canCheckMovingFromPlatformToBlock = false;
                    this.isJumpingFromPlatformToBlock = true;
                    // 서버로 메시지 전송 : 다른 클라이언트에서 해당 클라이언트에 운반용 부모로 만들도록
                    // 체크할 당시 캐릭터의 위치 - 점프 시도하는 순간의 위치
                    let relativePosition = this.transform.position - this.jumpPosition;
                    this.blockMultiplay.SendOnTryJumpForMovingToBlock(relativePosition, this.jumpPosition);
                }
            }

            //공중에 한 번 갔다가 다시 플랫폼으로 돌아오는 경우 
            if (hitInfo.collider.tag == "Platform") {
                if (this.isJumpingFromPlatformToBlock) {
                    this.canCheckMovingFromPlatformToBlock = true;
                    this.isJumpingFromPlatformToBlock = false;
                    this.prevLandedBlock = null;
                }
            }
        }
    }

    OnControllerColliderHit(hit: ControllerColliderHit) {

        // 만약 밟은 게 MovingBlock이고, 이전에 밟은 블록이랑 다른 블록이면 
        if (hit.gameObject.tag == "MovingBlock") {
            if (this.prevLandedBlock != hit.gameObject) {
                // 해당 블록으로 캐릭터가 블록을 밟았다는 메시지를 보냄 
                let movingBlock = hit.gameObject.transform.parent.GetComponent<MultiMovingBlock>();
                movingBlock.SetIsCharacterLandedOnBlock();
            }
            this.prevLandedBlock = hit.gameObject;
        }
        // 만약 밟은 게 OrbitingBlock이고, 이전에 밟은 블록이랑 다른 블록이면 
        if (hit.gameObject.tag == "OrbitingBlock") {
            if (this.prevLandedBlock != hit.gameObject) {
                // 해당 블록으로 캐릭터가 블록을 밟았다는 메시지를 보냄 
                let orbitingBlock = hit.gameObject.transform.parent.GetComponent<MultiOrbitingBlock>();
                orbitingBlock.SetIsCharacterLandedOnBlock();
            }
            this.prevLandedBlock = hit.gameObject;
        }

        if (hit.gameObject.tag != "Platform")
            return;

        // 직전에 밟았던 플랫폼이 아닌 또 다른 플랫폼에 착지한 경우
        if (this.prevLandedPlatform != hit.gameObject) {
            this.platformRenderer = hit.gameObject.GetComponentInChildren<Renderer>();
            this.isJumpingFromPlatformToBlock = false;
            this.canCheckMovingFromPlatformToBlock = true;
            this.prevLandedPlatform = hit.gameObject;
            this.prevLandedBlock = null;
            //서버로 메시지 전송 
            this.blockMultiplay.SendOnPlatformState();
        }

        //플랫폼 위의 캐릭터 위치 값 
        this.jumpPosition = new Vector3(this.gameObject.transform.position.x, this.platformRenderer.bounds.max.y, this.gameObject.transform.position.z);

    }

    private isFirstLandingOnPlatform: boolean = true;

    OnTriggerEnter(coll: Collider) {
        if (coll.gameObject.tag != "FallCheckTrigger") {
            return;
        }
        this.prevLandedPlatform = null;
    }

}