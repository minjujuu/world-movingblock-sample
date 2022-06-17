import { CharacterController, Collider, Mathf, Quaternion, Random, Renderer, Rigidbody, Time, Transform, Vector3 } from 'UnityEngine';
import { Text } from 'UnityEngine.UI'
import { ZepetoScriptBehaviour } from 'ZEPETO.Script'
import { CharacterState, ZepetoCharacter, ZepetoPlayers } from 'ZEPETO.Character.Controller'
import BlockMultiplay from './BlockMultiplay';

export default class MultiMovingBlock extends ZepetoScriptBehaviour {

    // 블록 이동 관련 변수 
    @Header("Move Block")
    public rigidbody: Rigidbody;
    public moveSpeed: Vector3;
    public timeToMove: number = 1;

    private moveDirection: int;
    private startPosition: Vector3;
    private goalPosition: Vector3;

    private isLocalPlayerOnBlock: boolean = false;
    private localCharacter: ZepetoCharacter;
    private localCharacterController: CharacterController;

    // 블록 회전 관련 변수
    @Header("Rotate Block (Option)")
    public isBlockRotating: boolean;
    public eulerAngleVelocity: Vector3;

    public characterRotateAroundSpeed: number = -1;

    // 멀티 동기화에 필요한 변수
    @Header("Multiplay Sync Setting")
    private isMultiplayMode: boolean = false;
    private myIdx: number = 0;

    private relativePosAtTryJump: Vector3 = Vector3.zero;
    private syncCharacterRigidbodies: Map<string, Rigidbody> = new Map<string, Rigidbody>();

    private clientElapsedTime: number = 0;

    private prevDirection: number;
    private shouldFixTransform: boolean = false;
    private blockMultiplayManager: BlockMultiplay;
    private renderer: Renderer;

    private Start() {

        this.moveDirection = 1;
        this.prevDirection = -1;

        this.rigidbody.useGravity = false;
        this.rigidbody.isKinematic = false;
        this.rigidbody.freezeRotation = true;
        this.rigidbody.velocity = this.moveSpeed * this.moveDirection;

        this.startPosition = this.transform.position;

        this.goalPosition = this.transform.position + this.moveSpeed * this.timeToMove;

        ZepetoPlayers.instance.OnAddedLocalPlayer.AddListener(() => {
            const myPlayer = ZepetoPlayers.instance.LocalPlayer.zepetoPlayer;
            this.localCharacter = ZepetoPlayers.instance.LocalPlayer.zepetoPlayer.character;
            this.localCharacterController = this.localCharacter.GetComponent<CharacterController>();

        });

        this.isLocalPlayerOnBlock = false;
        this.isMultiplayMode = false;

        this.renderer = this.GetComponentInChildren<Renderer>();
    }

    private FixedUpdate() {
        // 클라이언트 누적 시간
        this.clientElapsedTime += Time.fixedDeltaTime;

        // 룸에서 흐른 시간에 따라 블록 이동 방향 설정
        this.MoveBlock(this.clientElapsedTime);

        this.MoveLocalCharacterWithBlock();
        if (false == this.isBlockRotating)
            return;

        // 블록 및 캐릭터 회전
        this.RotateBlock();
        this.RotateCharacterWithBlock();
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
        // 로컬 플레이어 캐릭터이면 서버로 메시지 전송 (player.isOnBlock = true)
        this.blockMultiplayManager?.SendOnBlockTriggerEnter(this.myIdx);
    }

    private OnTriggerStay(coll: Collider) {

        if (coll.gameObject != this.localCharacter.gameObject) {
            return;
        }

        /* -------- 위치 동기화를 위한 부분 --------*/
        // 바닥에 착지했을 때 메시지를 전송 
        if (this.isLocalCharacterLanded) {
            this.isLocalCharacterLanded = false;
            if (this.isMultiplayMode) {
                let relativeVector = this.transform.position - this.localCharacter.transform.position;
                this.blockMultiplayManager?.SendOnLandedBlock(this.myIdx, relativeVector);
            }
        }

        // JUMP EVNET
        if (this.localCharacter.CurrentState == CharacterState.JumpIdle || this.localCharacter.CurrentState == CharacterState.JumpMove) {
            this.relativePosAtTryJump = this.transform.position - this.localCharacter.transform.position;
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
        this.blockMultiplayManager?.SendOnBlockTriggerExit(this.myIdx, this.relativePosAtTryJump);
    }

    /* MoveCharacterWithBlock() 
       - 로컬 캐릭터와 블록을 같이 이동시킵니다.
    */
    private MoveLocalCharacterWithBlock() {
        if (false == this.isLocalPlayerOnBlock)
            return;

        let velocity = this.moveSpeed * this.moveDirection;

        this.localCharacterController.Move(velocity * Time.fixedDeltaTime);
    }

    /* ChangeSyncCharacterVelocity() 
       - 블록의 velocity가 변경될 때 호출하여 멀티 캐릭터도 같은 속도로 움직이게 합니다.
    */
    private ChangeSyncCharacterVelocity() {
        this.syncCharacterRigidbodies.forEach((rb: Rigidbody, name: string) => {
            rb.velocity = this.rigidbody.velocity;
        });
    }

    /* RotateBlock() 
        - 블록 회전 옵션이 켜져있는 경우 블록을 회전시킵니다.
    */
    private RotateBlock() {
        let deltaRotation: Quaternion = Quaternion.Euler(this.eulerAngleVelocity * Time.fixedDeltaTime);
        this.rigidbody.MoveRotation(this.rigidbody.rotation * deltaRotation);
    }

    /* MoveCharacterWithBlock() 
       - 블록 회전 옵션이 켜져있는 경우 캐릭터를 같이 회전시킵니다.
    */
    private RotateCharacterWithBlock() {
        // 로컬 캐릭터 회전
        if (this.isLocalPlayerOnBlock) {
            this.localCharacter.transform.RotateAround(this.transform.position, Vector3.down, this.characterRotateAroundSpeed);
        }

        // 멀티 캐릭터 회전 
        this.syncCharacterRigidbodies.forEach((rb: Rigidbody, name: string) => {

            if (null != rb) {
                rb.gameObject.transform.RotateAround(this.transform.position, Vector3.down, this.characterRotateAroundSpeed);
            } else {
                this.syncCharacterRigidbodies.delete(name);
            }

        });
    }

    // ---------------------------------- Multiplay -----------------------------------
    /* InitMultiplayMode()
       - 처음 입장했거나 백그라운드에서 돌아왔을 때 멀티플레이 동기화를 위한 값들을 재설정합니다.
    */
    public InitMultiplayMode(elapsedTime: number) {
        this.isMultiplayMode = true;
        if (null == this.blockMultiplayManager) {
            this.blockMultiplayManager = BlockMultiplay.GetInstance();
        }
        this.shouldFixTransform = true;
        // 처음 한 번은 서버 시간 기준으로 예측 위치 반영 
        this.MoveBlock(elapsedTime);

        // 서버 시간이 변경되면 클라이언트 누적 시간도 그에 맞춰줌 
        this.clientElapsedTime = elapsedTime;
    }


    private stopToDetectTriggerExit: boolean = false;

    /* CalculatePredictedPosition()
       - 현재 서버의 룸에서 흐른 시간을 바탕으로 블록의 이동 방향을 설정합니다.
    */
    public MoveBlock(elapsedTime: number) {

        let predictedDir: number = (Mathf.Floor(elapsedTime / this.timeToMove)) % 2 == 0 ? 1 : -1;

        // 방향은 예측 방향으로 계속 설정
        this.moveDirection = predictedDir;

        // 이전 방향과 다른 경우에만 velocity 재설정
        if (this.moveDirection != this.prevDirection) {
            // 블록 이동 속도 재설정
            this.rigidbody.velocity = this.moveSpeed * this.moveDirection;
            // 블록 위에 있던 멀티 캐릭터들의 velocity 재설정 
            this.ChangeSyncCharacterVelocity();
        }

        this.prevDirection = this.moveDirection;
        // 처음 접속했을 때랑 백그라운드에서 돌아왔을 때만 위치도 조정
        if (this.shouldFixTransform) {
            this.CalculatePredictedPosition(elapsedTime);
        }
    }

    CalculatePredictedPosition(elapsedTime: number) {
        this.shouldFixTransform = false;
        let basePos: Vector3 = this.moveDirection == 1 ? this.startPosition : this.goalPosition;
        let predictedPos: Vector3 = basePos + (this.moveSpeed * this.moveDirection) * (elapsedTime % this.timeToMove);

        // 블록 위치 조정 
        this.transform.position = predictedPos;
        // 로컬/멀티 캐릭터 위치 조정
        this.ResetCharactersTransform(predictedPos);
    }

    ResetCharactersTransform(predictedPos: Vector3) {
        // 로컬 캐릭터 위치 재조정 
        if (this.isLocalPlayerOnBlock) {
            this.StartCoroutine(this.TeleportCharacter(predictedPos));
        }

        // 멀티 캐릭터 위치 조정
        this.syncCharacterRigidbodies.forEach((rb: Rigidbody, name: string) => {
            if (null != rb) {
                let adjustValue = Random.Range(-0.3, 0.3);
                let characterPosition = new Vector3(predictedPos.x + adjustValue, this.renderer.bounds.max.y, predictedPos.z + adjustValue);
                rb.transform.position = characterPosition;
                this.ChangeSyncCharacterVelocity();
            } else {
                // 블록 위에 있다가 방을 나간 경우 
                this.syncCharacterRigidbodies.delete(name);
            }
        });
    }

    /* TeleportCharacter()
       - 캐릭터를 블록 위로 이동시킵니다.
    */
    private *TeleportCharacter(predictedPos: Vector3) {
        this.stopToDetectTriggerExit = true; // 위치 조정 중에 트리거를 벗어난 건 무시
        this.isLocalPlayerOnBlock = false; // 텔레포트 중에 블록이 해당 캐릭터를 운반하도록 하지 않도록 하기 위해
        while (true) {
            yield null;
            let targetPos = new Vector3(predictedPos.x, this.renderer.bounds.max.y, predictedPos.z);

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

        if (false == this.syncCharacterRigidbodies.has(sessionId)) {
            let rigidbody = carrierParent.GetComponent<Rigidbody>();
            this.syncCharacterRigidbodies.set(sessionId, rigidbody);

            // velocity 초기화
            rigidbody.velocity = this.moveSpeed * this.moveDirection;
        }
    }

    /* RemoveCharacterOnBlock()
       - 해당 블록이 운반할 캐릭터에서 제거합니다.
    */
    public RemoveCharacterOnBlock(sessionId: string, relativePos: Vector3, carrierParent: Transform) {

        let position = this.transform.position - relativePos;
        carrierParent.position = position;

        if (this.syncCharacterRigidbodies.has(sessionId)) {
            // 나갈 땐 다시 velocity를 초기화
            this.syncCharacterRigidbodies.get(sessionId).velocity = Vector3.zero;
            this.syncCharacterRigidbodies.delete(sessionId);
        }
    }

    /* HasPlayerInCarrierPool()
       - 특정 캐릭터가 블록 위에 있는지 확인합니다.
    */
    public HasPlayerInCarrierPool(sessionId: string): boolean {

        if (this.syncCharacterRigidbodies.has(sessionId)) {
            return true;
        } else {
            return false;
        }
    }

    /* SetIsCharacterLandedOnBlock()
       - 캐릭터가 블록에 착지했을 경우 호출됩니다.
    */
    private isLocalCharacterLanded: boolean = false;
    public SetIsCharacterLandedOnBlock() {
        this.isLocalCharacterLanded = true;
    }

    /* SetBlockIdx()
        - 멀티플레이 시 블록 위 캐릭터 위치 동기화를 위해 현재 블록의 인덱스를 설정합니다.
    */
    public SetBlockIdx(idx: number) {
        this.myIdx = idx;

    }
}