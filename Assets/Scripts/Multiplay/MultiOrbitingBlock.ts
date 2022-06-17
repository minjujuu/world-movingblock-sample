import { CharacterController, Quaternion, Collider, Time, Vector3, Transform, Renderer, Random } from 'UnityEngine';
import { ZepetoScriptBehaviour } from 'ZEPETO.Script'
import { CharacterState, ZepetoCharacter, ZepetoPlayers } from 'ZEPETO.Character.Controller'
import BlockMultiplay from './BlockMultiplay';

export default class MultiOrbitingBlock extends ZepetoScriptBehaviour {

    // 블록 회전 관련 변수
    @Header("Orbit Block")
    public rotSpeed: number = 0;
    public rotatingPoint: Transform;
    public characterSpeedControlValue: number = 6;

    private startPosition: Vector3;
    private startRotation: Quaternion;
    private localCharacter: ZepetoCharacter;
    private localCharacterController: CharacterController;

    // 멀티 동기화에 필요한 변수
    private isMultiplayMode: boolean = false;
    private syncCharacterTransforms: Map<string, Transform> = new Map<string, Transform>();
    private myIdx: number = 0;

    private isLocalPlayerOnBlock: boolean = false;

    private rotateAroundAxis: Vector3;

    private prevBlockPosition: Vector3 = Vector3.zero;

    private isFixedPosition: boolean;
    private blockMultiplayManager: BlockMultiplay;
    private isLocalCharacterLanded: boolean = false;
    private relativePosAtJump: Vector3;

    private IsJumpingOnBlock: boolean = false;
    private renderer: Renderer;

    private Start() {
        this.startPosition = this.transform.position;
        this.startRotation = this.transform.rotation;

        ZepetoPlayers.instance.OnAddedLocalPlayer.AddListener(() => {
            this.localCharacter = ZepetoPlayers.instance.LocalPlayer.zepetoPlayer.character;
            this.localCharacterController = this.localCharacter.GetComponent<CharacterController>();
        });

        this.isLocalPlayerOnBlock = false;
        this.isMultiplayMode = false;

        this.rotateAroundAxis = Vector3.down;
        this.relativePosAtJump = Vector3.zero;

        this.renderer = this.GetComponentInChildren<Renderer>();
    }

    private Update() {

        // 블록 공전
        this.transform.RotateAround(this.rotatingPoint.position, this.rotateAroundAxis, this.rotSpeed * Time.deltaTime);

        // 블록 위에 있는 캐릭터들도 같이 이동
        this.MoveCharacterWithBlock();
    }

    private OnTriggerEnter(coll: Collider) {

        if (coll.gameObject == this.localCharacter.gameObject) {
            this.isLocalPlayerOnBlock = true;
        } else {
            return;
        }

        if (false == this.isMultiplayMode) {
            return;
        }

        this.blockMultiplayManager?.SendOnBlockTriggerEnter(this.myIdx);
    }


    private OnTriggerStay(coll: Collider) {
        if (false == this.isMultiplayMode) {
            return;
        }
        if (coll.gameObject != this.localCharacter.gameObject) {
            return;
        }

        // 착지 위치에 대한 메시지를 한 번만 보내기 위한 조건문
        if (this.isLocalCharacterLanded) {
            this.isLocalCharacterLanded = false;
            if (this.isMultiplayMode) {
                let diff = this.transform.position - this.localCharacter.transform.position;
                this.blockMultiplayManager.SendOnLandedBlock(this.myIdx, diff);
            }
        }

        if (this.localCharacter.CurrentState == CharacterState.JumpIdle || this.localCharacter.CurrentState == CharacterState.JumpMove) {
            this.relativePosAtJump = this.transform.position - this.localCharacter.transform.position;
        }
    }

    private OnTriggerExit(coll: Collider) {

        if (coll.gameObject == this.localCharacter.gameObject) {
            this.isLocalPlayerOnBlock = false;
        } else {
            return;
        }
        if (false == this.isMultiplayMode || true == this.stopToDetectTriggerExit) {
            return;
        }
        // 로컬 플레이어 캐릭터이면 서버로 메시지 전송 (player.isOnBlock = false)
        this.blockMultiplayManager?.SendOnBlockTriggerExit(this.myIdx, this.relativePosAtJump);

    }

    public SetIsCharacterLandedOnBlock() {
        this.isLocalCharacterLanded = true;
    }

    /* MoveCharacterWithBlock() 
       - 캐릭터와 블록을 같이 이동시킵니다.
    */
    private MoveCharacterWithBlock() {

        // 블록이 이동하는 방향으로의 벡터 
        let curBlockPosition = this.transform.position;
        let forwardVector = (curBlockPosition - this.prevBlockPosition).normalized;
        this.prevBlockPosition = this.transform.position;

        // 로컬 캐릭터 이동
        if (this.isLocalPlayerOnBlock) {
            this.localCharacterController.Move(forwardVector * (this.rotSpeed / this.characterSpeedControlValue) * Time.deltaTime);
        }

        if (this.syncCharacterTransforms.size == 0)
            return;

        // 멀티 캐릭터 이동
        this.syncCharacterTransforms.forEach((characterTr: Transform, name: string) => {

            if (null != characterTr) {
                characterTr.RotateAround(this.rotatingPoint.position, this.rotateAroundAxis, this.rotSpeed * Time.deltaTime);
            } else {
                this.syncCharacterTransforms.delete(name);
            }
        });
    }


    // ---------------------------------- Multiplay -----------------------------------
    /* SetBlockIdx()
       - 멀티플레이 시 블록 위 캐릭터 위치 동기화를 위해 현재 블록의 인덱스를 설정합니다.
    */
    public SetBlockIdx(idx: number) {
        this.myIdx = idx;
    }

    /* SetMultiRoomElapsedTime()
       - 멀티플레이 동기화 시 블록 위치 동기화를 위해 현재 룸에서 흐른 시간을 설정합니다.
    */
    public InitMultiplayMode(elapsedTime: number) {
        // 멀티플레이 모드 활성화
        this.isMultiplayMode = true;
        if (null == this.blockMultiplayManager) {
            this.blockMultiplayManager = BlockMultiplay.GetInstance();
        }
        // 처음 한 번만 반영
        this.CalculatePredictedTransform(elapsedTime);
    }

    private stopToDetectTriggerExit: boolean = false;
    /* CalculatePredictedPosition()
       - 현재 룸에서 흐른 시간을 바탕으로 블록의 예측 위치를 계산합니다.
    */
    public CalculatePredictedTransform(elapsedTime: number) {

        let center = this.rotatingPoint.position;
        let axis = this.rotateAroundAxis;
        let angle = this.rotSpeed * elapsedTime;

        // Rotate Around Algorithm
        let pos: Vector3 = this.startPosition;
        let rot: Quaternion = Quaternion.AngleAxis(angle, axis);
        let dir: Vector3 = pos - center;
        dir = rot * dir;
        let predictedPos = center + dir;
        let myRot: Quaternion = this.startRotation;
        let predictedRot = myRot * Quaternion.Inverse(myRot) * rot * myRot;

        // 블록의 위치와 이동 방향을 예측된 값으로 조정
        this.transform.position = predictedPos;
        this.transform.rotation = predictedRot;

        // 로컬 캐릭터 위치 재조정
        if (this.isLocalPlayerOnBlock) {
            this.StartCoroutine(this.TeleportCharacter(predictedPos));
        }

        // 동기화 캐릭터들은 서버에서 조정해줄 거라서         
        this.syncCharacterTransforms.forEach((characterTr: Transform, name: string) => {
            if (null != characterTr) {
                let characterPosition = new Vector3(predictedPos.x, this.renderer.bounds.max.y, predictedPos.z);
                characterTr.position = characterPosition;
            } else {
                // 블록 위에 있다가 방을 나간 경우 
                this.syncCharacterTransforms.delete(name);
            }
        });
    }

    private *TeleportCharacter(predictedPos: Vector3) {

        this.stopToDetectTriggerExit = true; // 위치 조정 중에 트리거를 벗어난 건 무시
        this.isLocalPlayerOnBlock = false; // 텔레포트 중에 블록이 해당 캐릭터를 운반하도록 하지 않도록 하기 위해

        while (true) {
            yield null;
            let adjustValue = Random.Range(-0.3, 0.3);
            let targetPos = new Vector3(predictedPos.x + adjustValue, this.renderer.bounds.max.y, predictedPos.z + adjustValue);

            this.localCharacter.transform.position = targetPos;

            if (this.localCharacter.transform.position == targetPos) {
                this.stopToDetectTriggerExit = false;
                break;
            }
        }
    }

    /* AddCharacterOnBlock()
      - 해당 블록이 운반할 캐릭터에 등록합니다.
    */
    public AddCharacterOnBlock(sessionId: string, relativeVector: Vector3, carrierParent: Transform) {
        let position = this.transform.position - relativeVector;
        let result = new Vector3(position.x, this.renderer.bounds.max.y, position.z);

        carrierParent.position = result;

        if (false == this.syncCharacterTransforms.has(sessionId)) {
            this.syncCharacterTransforms.set(sessionId, carrierParent);
        }
    }

    /* RemoveCharacterOnBlock()
       - 해당 블록이 운반할 캐릭터에서 제거합니다.
    */
    public RemoveCharacterOnBlock(sessionId: string, relativePos: Vector3, carrierParent: Transform) {
        let position = this.transform.position - relativePos;
        carrierParent.position = position;

        if (this.syncCharacterTransforms.has(sessionId)) {
            this.syncCharacterTransforms.delete(sessionId);
        }

    }

    public HasPlayerInCarrierPool(sessionId: string): boolean {
        if (this.syncCharacterTransforms.has(sessionId)) {
            return true;
        } else {
            return false;
        }
    }

}