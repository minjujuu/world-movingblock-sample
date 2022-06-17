import { Coroutine, GameObject, RuntimeAnimatorController, Mathf, Quaternion, Transform, Vector3, WaitForSeconds, Time, YieldInstruction, Rigidbody, AnimationClip } from 'UnityEngine';
import { Text } from 'UnityEngine.UI';
import { Room, RoomData } from 'ZEPETO.Multiplay';
import { ZepetoScriptBehaviour } from 'ZEPETO.Script'
import { ZepetoWorldMultiplay } from 'ZEPETO.World';
import { Player, State } from 'ZEPETO.Multiplay.Schema';
import { CharacterState, ZepetoPlayers } from 'ZEPETO.Character.Controller';
import CharacterEventChecker from './CharacterEventChecker';
import CarrierParentController from './CarrierParentController';
import MultiMovingBlock from './MultiMovingBlock';
import MultiOrbitingBlock from './MultiOrbitingBlock';
/**
 * Interface
 * 
 * PlayerBlockInfo
 *  캐릭터가 블록에 착지했을 때 상대적 위치 벡터
 * 
 * PlayerPlatformInfo
 *  캐릭터가 플랫폼에 착지했을 때 상대적 위치 벡터와 캐릭터가 점프를 시작한 플랫폼 위의 위치
 * 
 * PlayerTimestamp
 *  게임시작 timestamp와 플레이어 접속시점 timestamp
*/

interface PlayerBlockInfo {
    sessionId: string,
    blockIndex: number,
    relativeX: number,
    relativeY: number,
    relativeZ: number
}

interface PlayerPlatformInfo {
    sessionId: string,
    relativeX: number,
    relativeY: number,
    relativeZ: number,
    posX: number,
    posY: number,
    posZ: number
}

interface PlayerTimestamp {
    gameStartTimestamp: number,
    playerJoinTimestamp: number;
}

export default class BlockMultiplay extends ZepetoScriptBehaviour {

    public multiplay: ZepetoWorldMultiplay;
    private room: Room;

    public movingBlocks: GameObject[];
    public orbitingBlocks: GameObject[];

    private movingBlockScripts: MultiMovingBlock[];
    private orbitingBlockScripts: MultiOrbitingBlock[];

    // 현재 블럭의 인덱스입니다.
    private blockIdx: number = 0;

    // 캐릭터 위치 멀티 동기화 시 필요한 변수들
    public carrierParentPrefab: GameObject; //운반용 부모 프리팹
    private originCharacterParents: Map<string, GameObject> = new Map<string, GameObject>();
    private characterContexts: Map<string, GameObject> = new Map<string, GameObject>();
    private carrierParents: Map<string, GameObject> = new Map<string, GameObject>();

    // 블럭 동기화를 위한 변수 
    private gameStartTimestampFromServer: number = 0;
    private diffTimestamp: number = 0;

    // 캐릭터가 맵 내에서 리스폰 될 포인트 입니다.
    public respawnPoint: Transform;

    // 플레이어가 백그라운드로 나갔다 돌아온 경우를 판단하는 변수입니다.
    private bPaused: boolean = false;

    // 캐릭터 점프 시 점프 동기화 및 Animation 동기화에 필요한 변수들   
    public moveBlockAnimator: RuntimeAnimatorController;
    private isLanding: Map<string, boolean> = new Map<string, boolean>();
    private playerTargetPosition: Map<string, Vector3> = new Map<string, Vector3>();
    private jumpCoroutines: Map<string, Coroutine> = new Map<string, Coroutine>();
    private changeTargetPositionCoroutines: Map<string, Coroutine> = new Map<string, Coroutine>();
    private playerJumpDistances: Map<string, number> = new Map<string, number>();
    private playerFlightDuration: Map<string, number> = new Map<string, number>();
    private playerJumpDistance: number = 3;
    private waitForChangeTargetSeconds: YieldInstruction = new WaitForSeconds(0.1);
    private isLandingPlatform: Map<string, boolean> = new Map<string, boolean>();

    private static Instance: BlockMultiplay;
    /* Singleton */
    public static GetInstance(): BlockMultiplay {
        if (!BlockMultiplay.Instance) {
            const targetObj = GameObject.Find("BlockMultiplay");
            if (targetObj)
                BlockMultiplay.Instance = targetObj.GetComponent<BlockMultiplay>();
        }
        return BlockMultiplay.Instance;
    }

    private MESSAGE_TYPE_ServerTimestamp = "ServerTimestamp";
    private MESSAGE_TYPE_OnBlockTriggerEnter = "OnBlockTriggerEnter";
    private MESSAGE_TYPE_OnCharacterLandedBlock = "OnCharacterLandedBlock";
    private MESSAGE_TYPE_OnCharacterJumpOnBlock = "OnCharacterJumpOnBlock";
    private MESSAGE_TYPE_OnTryJump = "OnTryJump";
    private MESSAGE_TYPE_OnPlatformState = "OnPlatformState";
    private MESSAGE_TYPE_OnFallTriggerEnter = "OnFallTriggerEnter";
    private MESSAGE_TYPE_OnTryJumpForMovingToBlock = "OnTryJumpForMovingToBlock";
    private MESSAGE_TYPE_OnLeavePlayer = "OnLeavePlayer";

    private Start() {

        this.bPaused = false;
        this.blockIdx = 0;

        this.movingBlockScripts = new Array<MultiMovingBlock>(this.movingBlocks.length);
        this.orbitingBlockScripts = new Array<MultiOrbitingBlock>(this.orbitingBlocks.length);

        for (let i = 0; i < this.movingBlocks.length; i++) {
            this.movingBlockScripts[i] = this.movingBlocks[i].GetComponent<MultiMovingBlock>();
            this.movingBlockScripts[i].SetBlockIdx(this.blockIdx++);
        }

        for (let i = 0; i < this.orbitingBlocks.length; i++) {
            this.orbitingBlockScripts[i] = this.orbitingBlocks[i].GetComponent<MultiOrbitingBlock>();
            this.orbitingBlockScripts[i].SetBlockIdx(this.blockIdx++);
        }

        this.multiplay.RoomCreated += (room: Room) => {
            this.room = room;
            this.AddMessageHandlersForBlockSync();
            this.AddMessageHandlersForCharacterSync();
        };

        // 로컬 캐릭터에 블록과의 충돌 체크를 위한 스크립트 추가
        ZepetoPlayers.instance.OnAddedLocalPlayer.AddListener(() => {
            ZepetoPlayers.instance.LocalPlayer.zepetoPlayer.character.gameObject.AddComponent<CharacterEventChecker>();
        });
    }

    private OnApplicationPause(pause: boolean) {
        // 백그라운드 갔다가 돌아온 경우 블록 위치 동기화 재설정
        if (pause) {
            this.bPaused = true;
        } else {
            if (this.bPaused) {
                this.bPaused = false;
                // 현재 timestamp 
                let curClientTimestamp = + new Date();

                // 진행된 시간 = 현재 timestamp - (게임 시작 timestamp + diff) // ex. 3월 6일 30초 - (3월 1일 + 5일)
                let elapsedTime = curClientTimestamp - (this.gameStartTimestampFromServer + this.diffTimestamp);

                // 블록에 전달하기 위해 초 단위로 변경  
                let timestampSecond = elapsedTime / 1000;

                // 각 블록에 현재 룸에서 흐른 시간을 전달합니다.
                for (let i = 0; i < this.movingBlockScripts.length; i++) {
                    this.movingBlockScripts[i].InitMultiplayMode(timestampSecond);
                }
                // 각 블록에 현재 룸에서 흐른 시간을 전달합니다.
                for (let i = 0; i < this.orbitingBlockScripts.length; i++) {
                    this.orbitingBlockScripts[i].InitMultiplayMode(timestampSecond);
                }
            }
        }
    }

    /* AddMessageHandlersForBlockSync()
       - 블록 위치 동기화를 위한 메시지 핸들러입니다.
    */
    private AddMessageHandlersForBlockSync() {

        // 처음 서버에 Join 시 게임시작 timestamp와 플레이어 접속시점 timestamp를 전달 받습니다.
        this.room.AddMessageHandler(this.MESSAGE_TYPE_ServerTimestamp, (message: PlayerTimestamp) => {

            let timestampInfo: PlayerTimestamp = {
                gameStartTimestamp: message.gameStartTimestamp,
                playerJoinTimestamp: message.playerJoinTimestamp
            };

            // 서버에서의 게임시작 시점 timestamp 캐싱
            this.gameStartTimestampFromServer = Number(timestampInfo.gameStartTimestamp);

            // 서버에서의 플레이어의 Join 시점 timestamp
            let playerJoinTimestampFromServer = Number(timestampInfo.playerJoinTimestamp);

            // 현재 클라이언트 시간
            let curClientTimeStamp = + new Date();

            // 서버에서의 timestamp와 클라이언트에서의 timestamp의 차이를 저장
            // - 백그라운드에서 돌아와서 블록 위치 재조정 시 차이값 보정을 위함 
            let diff: number = curClientTimeStamp - playerJoinTimestampFromServer;
            this.diffTimestamp = diff; // 차이값 저장

            // 게임 시작 후 흐른 시간
            let elapsedTime = playerJoinTimestampFromServer - this.gameStartTimestampFromServer;

            // 블록 계산을 위해 초 단위로 변경
            let timestampSecond = elapsedTime / 1000;

            // 각 블록에 흐른 시간 전달
            for (let i = 0; i < this.movingBlockScripts.length; i++) {
                this.movingBlockScripts[i].InitMultiplayMode(timestampSecond);
            }

            for (let i = 0; i < this.orbitingBlockScripts.length; i++) {
                this.orbitingBlockScripts[i].InitMultiplayMode(timestampSecond);
            }
        });
    }

    /* AddMessageHandlersForCharacterSync()
       - 캐릭터 위치 동기화를 위한 메시지 핸들러입니다.
       MESSAGE_TYPE_OnPlatformState : 캐릭터가 플랫폼에 올라간 경우
       MESSAGE_TYPE_OnTryJumpForMovingToBlock : 캐릭터가 플랫폼에서 블록으로 이동을 시도한 경우
       MESSAGE_TYPE_OnCharacterLandedBlock : 캐릭터가 무빙블록에 착지한 경우 (상대적 위치 값 전달 받음)
       MESSAGE_TYPE_OnCharacterJumpOnBlock : 캐릭터가 블록위에서 점프를 한 경우
       MESSAGE_TYPE_OnFallTriggerEnter : 캐릭터가 떨어져 FallTrigger에 닿은 경우
       MESSAGE_TYPE_OnLeavePlayer : 캐릭터가 룸에서 나가는 경우
    */
    private AddMessageHandlersForCharacterSync() {

        // 캐릭터가 무빙블록에서 내려오고 플랫폼에 올라갔을 때 운반용 부모를 해제하고 원래 부모로 설정합니다.
        this.room.AddMessageHandler(this.MESSAGE_TYPE_OnPlatformState, (message: string) => {
            // 기존 동기화 로직 실행을 위해 context를 원래 부모로 돌려놔줌
            const sessionId: string = message.toString();
            if (false == this.characterContexts.has(sessionId)) {
                return;
            }
            this.ResetOriginParent(sessionId);
            this.ResetJumpToBlockSetting(sessionId);
        });

        // 캐릭터가 플랫폼에서 무빙블록에 올라가려고 시도할 때 메시지를 전달 받습니다.
        this.room.AddMessageHandler(this.MESSAGE_TYPE_OnTryJumpForMovingToBlock, (message: PlayerPlatformInfo) => {
            const relativeVector = new Vector3(message.posX, message.posY, message.posZ);
            const platformPosition = new Vector3(message.relativeX, message.relativeY, message.relativeZ);
            const sessionId: string = message.sessionId;
            this.SetCarrierParentAndZepetoContext(sessionId);
            //플랫폼에서 무빙블록에 올라가는 경우 인덱스는 -1을 보내고 해당 경우에만 점프 시 플랫폼에서 점프한 위치를 전달해서 보냅니다.
            this.SetJumpToBlockSetting(sessionId, -1, relativeVector, this.FIRSTBLOCK, platformPosition);
        });

        // 캐릭터가 블록에 착지했을 때 상대적 위치 벡터를 메시지로 전달 받습니다.        
        this.room.AddMessageHandler(this.MESSAGE_TYPE_OnCharacterLandedBlock, (message: PlayerBlockInfo) => {
            // 해당 캐릭터를 블록 위로 텔레포트
            this.TeleportCharacterOnBlock(message);
        });

        // 캐릭터가 블록에서 점프했을 때 상대적 위치 벡터를 메시지로 전달 받습니다.
        this.room.AddMessageHandler(this.MESSAGE_TYPE_OnCharacterJumpOnBlock, (message: PlayerBlockInfo) => {
            this.OnBlockTriggerExit(message);
        });

        // 캐릭터가 떨어진 경우 메시지를 전달 받습니다.
        this.room.AddMessageHandler(this.MESSAGE_TYPE_OnFallTriggerEnter, (message: string) => {
            const sessionId: string = message.toString();
            this.ResetJumpToBlockSetting(sessionId);
            // 해당 캐릭터를 리스폰
            if (this.carrierParents.has(sessionId)) {
                this.StartCoroutine(this.RespwanCharacter(sessionId));
            }
        });

        // 캐릭터가 나가는 시점에 메시지를 전달받습니다.
        this.room.AddMessageHandler(this.MESSAGE_TYPE_OnLeavePlayer, (message: string) => {
            const sessionId: string = message.toString();
            // 사용했던 인스턴스들 삭제
            if (this.carrierParents.has(sessionId)) {
                this.carrierParents.delete(sessionId);
            }
            if (this.characterContexts.has(sessionId)) {
                this.characterContexts.delete(sessionId);
            }
            if (this.originCharacterParents.has(sessionId)) {
                this.originCharacterParents.delete(sessionId);
            }
        });
    }

    /*
        캐릭터가 떨어진 경우 리스폰 포인트로 이동 시킵니다.
    */
    private *RespwanCharacter(sessionId: string) {
        const carrierParent = this.carrierParents.get(sessionId);
        while (carrierParent.transform.position != this.respawnPoint.position) {
            carrierParent.transform.position = this.respawnPoint.position;
            yield null;
        }
    }

    // ------------------------ 서버로 메시지를 전송하기 위한 함수들 ------------------------
    /* SendOnTryJumpForMovingToBlock()
       - 캐릭터가 플랫폼에서 무빙블록에 올라가려고 시도할 때 메시지를 전송합니다.
    */
    public SendOnTryJumpForMovingToBlock(position: Vector3, platformPosition: Vector3) {
        const data = new RoomData();
        const relativePos = new RoomData();
        const platformPos = new RoomData();

        relativePos.Add("x", position.x);
        relativePos.Add("y", position.y);
        relativePos.Add("z", position.z);
        data.Add("relativePos", relativePos.GetObject());

        platformPos.Add("x", platformPosition.x);
        platformPos.Add("y", platformPosition.y);
        platformPos.Add("z", platformPosition.z);
        data.Add("platformPos", platformPos.GetObject());

        this.room.Send(this.MESSAGE_TYPE_OnTryJumpForMovingToBlock, data.GetObject());
    }

    /* SendOnBlockTriggerEnter() 
       - 플레이어가 무빙블록 트리거에 들어간 순간 서버로 메시지를 전송합니다.
    */
    public SendOnBlockTriggerEnter(blockIdx: number) {
        this.room.Send(this.MESSAGE_TYPE_OnBlockTriggerEnter, blockIdx);
    }

    /* SendOnBlockTriggerExit() 
       - 플레이어가 무빙블록 트리거에서 나오는 순간의 상대적 위치 벡터를 전송합니다.
    */
    public SendOnBlockTriggerExit(blockIdx: number, relativePosition: Vector3) {
        const data = new RoomData();
        data.Add("blockIdx", blockIdx);

        const relativePos = new RoomData();
        relativePos.Add("x", relativePosition.x);
        relativePos.Add("y", relativePosition.y);
        relativePos.Add("z", relativePosition.z);

        data.Add("relativePos", relativePos.GetObject());

        this.room.Send(this.MESSAGE_TYPE_OnCharacterJumpOnBlock, data.GetObject());
    }

    /* SendOnLandedBlock() 
       - 로컬 캐릭터가 블록 위에 착지했을 때 서버로 상대적 위치 벡터를 전송합니다.
    */
    public SendOnLandedBlock(blockIdx: number, relativeVector: Vector3) {
        const data = new RoomData();
        data.Add("blockIdx", blockIdx);

        const relativePos = new RoomData();
        relativePos.Add("x", relativeVector.x);
        relativePos.Add("y", relativeVector.y);
        relativePos.Add("z", relativeVector.z);
        data.Add("relativePos", relativePos.GetObject());

        this.room.Send(this.MESSAGE_TYPE_OnCharacterLandedBlock, data.GetObject());
    }

    /* SendOnPlatformState() 
       - 로컬 캐릭터가 플랫폼 위에 착지했을 때 서버로 상대적 위치 벡터를 전송합니다.
    */
    public SendOnPlatformState() {
        this.room.Send(this.MESSAGE_TYPE_OnPlatformState);
    }

    /* SendOnFallTriggerEnter() 
       - 로컬 캐릭터가 블록 아래로 떨어졌을 때 서버로 메시지를 전송합니다.
    */
    public SendOnFallTriggerEnter() {
        this.room.Send(this.MESSAGE_TYPE_OnFallTriggerEnter);
    }

    /* SendTryJump() 
       - 로컬 캐릭터가 블록 위에서 점프를 시도했을 때 메시지를 전송합니다.
    */
    public SendTryJump(isJumping: boolean) {
        this.room.Send(this.MESSAGE_TYPE_OnTryJump, isJumping);
    }

    /* CheckPlayerOnBlock()
       - 룸에 먼저 들어와 있던 캐릭터가 블록 위에 있다면 관련 설정들을 진행합니다.
    */
    public CheckPlayerOnBlock(sessionId: string) {

        let player: Player = this.room.State.players.get_Item(sessionId);
        let serverBlockIndex = player.blockIndex;
        if (player.isOnBlock) {
            // Moving Block인 경우
            if (this.IsMovingBlock(serverBlockIndex)) {
                // 해당 블록의 운반 대상에 해당 캐릭터가 있는지 확인 
                if (false == this.movingBlockScripts[serverBlockIndex].HasPlayerInCarrierPool(sessionId)) {
                    // 없다면 운반용 부모 생성 및 설정
                    this.SetCarrierParentAndZepetoContext(sessionId);

                    let relativeVector: Vector3 = Vector3.zero;
                    let carrierParent: Transform = this.carrierParents.get(sessionId).transform;
                    // 해당 블록의 운반 대상으로 등록
                    this.movingBlockScripts[serverBlockIndex].AddCharacterOnBlock(sessionId, relativeVector, carrierParent);
                }
            }
            // OrbitingBlock인 경우
            else {
                let newIndex = this.GetBlockIndex(serverBlockIndex);
                // 해당 블록의 운반 대상에 해당 캐릭터가 있는지 확인 
                if (false == this.orbitingBlockScripts[newIndex].HasPlayerInCarrierPool(sessionId)) {
                    // 없다면 운반용 부모 생성 및 설정
                    this.SetCarrierParentAndZepetoContext(sessionId);

                    let relativeVector: Vector3 = Vector3.zero;
                    let carrierParent: Transform = this.carrierParents.get(sessionId).transform;
                    // 해당 블록의 운반 대상으로 등록
                    this.orbitingBlockScripts[newIndex].AddCharacterOnBlock(sessionId, relativeVector, carrierParent);

                }
            }
        }
    }

    /* ResetOriginParent() 
       - 운반용 부모에서 원래의 Zepeto Character 부모로 돌려놓습니다. 
    */
    private ResetOriginParent(sessionId: string) {
        const context = this.characterContexts.get(sessionId);
        const originParent = this.originCharacterParents.get(sessionId);
        const character = ZepetoPlayers.instance.GetPlayer(sessionId).character;

        originParent.transform.position = this.carrierParents.get(sessionId).transform.position;
        originParent.transform.rotation = this.carrierParents.get(sessionId).transform.rotation;

        context.transform.SetParent(originParent.transform);
        context.transform.localPosition = Vector3.zero;
        context.transform.localEulerAngles = Vector3.zero;

        originParent.SetActive(true);

        /**
         * carrierParent에서 originParent로 변경하는 순간 입력이 없다면 기존 state가 실행되어 JumpMove,Run 등의 state에서 캐릭터가 플랫폼에 랜딩한 뒤 뛰어 나가는 이슈가 있음 
         * TODO : 강제로 state를 변경하기 위해 임의의 제스처를 실행하고 일정 시간 후 제스처를 취소하는 로직이지만 해당 로직도 0.2초 이후이 입력없으면 위 상황과 동일하여 이후 State 초기화가 가능하면 해당 코드 수정 예정
         * */
        if (character.CurrentState == CharacterState.JumpMove || character.CurrentState == CharacterState.Run)
            this.StartCoroutine(this.CancelGestureCorutine(sessionId));
    }

    private *CancelGestureCorutine(sessionId: string) {

        const character = ZepetoPlayers.instance.GetPlayer(sessionId).character;
        character.SetGesture(this.gesture);
        yield new WaitForSeconds(0.2);
        while (character.CurrentState == CharacterState.Gesture) {
            character.CancelGesture();
            yield null;
        }
    }

    public gesture: AnimationClip;

    /* SetCarrierParentAndZepetoContext() 
       - 블록 간 이동을 위해 기존 캐릭터 밑에 있던 Zepeto Context를 가져와 운반용 부모에 붙여줍니다.
    */
    private SetCarrierParentAndZepetoContext(sessionId: string) {

        // 운반용 부모가 없다면 생성
        if (false == this.carrierParents.has(sessionId)) {
            var obj = GameObject.Instantiate<GameObject>(this.carrierParentPrefab);
            obj.GetComponent<CarrierParentController>().SetSessionId(sessionId);
            obj.name = `CarrierParent_${sessionId}`;
            this.carrierParents.set(sessionId, obj);
        }

        // 중력 설정 초기화
        this.carrierParents.get(sessionId).GetComponent<Rigidbody>().useGravity = false;

        // 있다면 운반용 부모를 가져옴 
        let carrierParent = this.carrierParents.get(sessionId);
        const character = ZepetoPlayers.instance.GetPlayer(sessionId).character;

        // carrierParent가 엉뚱한 위치에 있는 경우가 있어 기존 캐릭터 위치로 설정 
        carrierParent.transform.position = character.transform.position;
        carrierParent.transform.rotation = character.transform.rotation;

        // context 추출 후 나중에 다시 돌려놓기 위해 Map에 저장 
        const context = character.Context.gameObject;
        this.characterContexts.set(sessionId, context);

        // context에 새로운 운반용 부모를 설정 및 앵글, 포지션 초기화
        context.transform.SetParent(carrierParent.transform);
        context.transform.localEulerAngles = Vector3.zero;
        context.transform.localPosition = Vector3.zero;

        // 원래 부모는 나중에 다시 사용하기 위해 Map에 저장
        this.originCharacterParents.set(sessionId, character.gameObject);
        character.gameObject.SetActive(false); // 비활성화
    }

    /* GetBlockIndex() 
       - Moving Block인지 Orbiting Block인지에 따라 인덱스를 조정하여 반환합니다.
    */
    private GetBlockIndex(idx: number): number {
        if (idx < this.movingBlocks.length) {
            return idx;
        } else {
            return idx - this.movingBlocks.length;
        }
    }

    /* TeleportBlockRelativePosition() 
       - 리모트 캐릭터를 특정 블록의 상대적 위치로 이동시키고, 해당 블록의 운반 대상으로 등록합니다.
         운반대상에 등록된 리모트 캐릭터는 무빙블럭과 함께 움직입니다.
    */
    TeleportCharacterOnBlock(message: PlayerBlockInfo) {
        const sessionId: string = message.sessionId;

        // 점프 관련 처리 
        if (this.carrierParents.has(sessionId)) {
            const animator = ZepetoPlayers.instance.GetPlayer(sessionId).character.ZepetoAnimator;
            animator.runtimeAnimatorController = this.moveBlockAnimator;
            animator.enabled = true;
            animator.SetBool("JumpMove", false);
        }

        // 랜딩 상태일때 기존 점프 코루틴 정지
        this.StopJumpToBlockCoroutine(sessionId);

        const blockIdx: number = message.blockIndex;
        const relativePos = new Vector3(message.relativeX, message.relativeY, message.relativeZ);

        let carrierParent = this.carrierParents.get(sessionId);
        if (this.IsMovingBlock(blockIdx)) {
            let blockIndex = this.GetBlockIndex(blockIdx);
            this.movingBlockScripts[blockIndex].AddCharacterOnBlock(sessionId, relativePos, carrierParent.transform);
        } else {
            let blockIndex = this.GetBlockIndex(blockIdx);
            this.orbitingBlockScripts[blockIndex].AddCharacterOnBlock(sessionId, relativePos, carrierParent.transform);
        }
    }


    private MOVINGBLOCK: number = 0;
    private ORBITINGBLOCK: number = 1;
    private FIRSTBLOCK: number = 2;

    /* TeleportSameBlockRelativePosition() 
       - 리모트 캐릭터를 같은 블록 내 점프 위치로 이동시키고, 해당 블록의 운반 대상에서 삭제합니다.
    */
    OnBlockTriggerExit(message: PlayerBlockInfo) {

        const sessionId: string = message.sessionId;
        const blockIdx: number = message.blockIndex;
        const relativePos = new Vector3(message.relativeX, message.relativeY, message.relativeZ);

        if (false == this.carrierParents.has(sessionId))
            return;

        let carrierParent = this.carrierParents.get(sessionId);
        let blockIndex = this.GetBlockIndex(blockIdx);

        if (this.IsMovingBlock(blockIdx)) {
            this.movingBlockScripts[blockIndex].RemoveCharacterOnBlock(sessionId, relativePos, carrierParent.transform);
            this.SetJumpToBlockSetting(sessionId, blockIndex, relativePos, this.MOVINGBLOCK);
        } else {
            this.orbitingBlockScripts[blockIndex].RemoveCharacterOnBlock(sessionId, relativePos, carrierParent.transform);
            this.SetJumpToBlockSetting(sessionId, blockIndex, relativePos, this.ORBITINGBLOCK);
        }

    }

    /*IsMovingBlock()
        -  블럭의 인덱스를 통해 현재 블럭이 무빙블록 인지 아닌지를 반환합니다.
    */
    private IsMovingBlock(blockIdx: number): boolean {
        if (blockIdx < this.movingBlocks.length) {
            return true;
        } else {
            return false;
        }
    }

    /*MoveBlockToPlatform()
        - 플레이어가 캐리어를 가지고 플랫폼에 들어는 순간에 원래의 Zepeto Character 설정으로 돌려놓습니다.
    */
    public MoveBlockToPlatform(sessionId: string) {
        // 기존 동기화 로직 실행을 위해 context를 원래 부모로 돌려놔줌
        if (false == this.characterContexts.has(sessionId)) {
            return;
        }
        this.isLandingPlatform.set(sessionId, true);
        this.ResetJumpToBlockSetting(sessionId);
        this.ResetOriginParent(sessionId);
    }

    public GetIsLandingPlatform(sessionId: string): boolean {
        return this.isLandingPlatform.get(sessionId);
    }

    public SetIsLandingPlatform(sessionId: string, isLandingPlatform: boolean) {
        this.isLandingPlatform.set(sessionId, isLandingPlatform);
    }


    /* ResetJumpToBlockSetting() 
       - 무빙블록간 운반을 위해 지정되었던 애니메이터와 코루틴을 기존 상태로 돌려놓습니다.
    */
    private ResetJumpToBlockSetting(sessionId: string) {
        const animator = ZepetoPlayers.instance.GetPlayer(sessionId).character.ZepetoAnimator;
        animator.runtimeAnimatorController = ZepetoPlayers.instance.characterData.animatorController;
        this.playerTargetPosition.delete(sessionId);
        this.isLanding.delete(sessionId);
        this.isLandingPlatform.delete(sessionId);
        this.playerJumpDistances.delete(sessionId);
        this.playerFlightDuration.delete(sessionId);
        this.StopJumpToBlockCoroutine(sessionId);
    }

    private SetJumpToBlockSetting(sessionId: string, blockIndex: number, relativeVector: Vector3, blockFlag: number, platformPosition?: Vector3) {

        // blockPosition은 캐릭터가 서 있던 블럭의 position 이고 startPosition은 캐릭터가 점프하면서 나간 triggerExit 시점의 위치입니다. 
        var blockPosition: Vector3 = Vector3.zero;
        var startPosition: Vector3 = Vector3.zero;

        if (blockFlag == this.FIRSTBLOCK) { // 플랫폼에서 블록으로 가는 경우
            //플랫폼에서 나가는 경우에는 platformPosition을 보내 현재 블럭의 position이 아닌 플랫폼에서 점프한 위치를 가져오고 이미 계산한 relativeVector를 구해서 보냅니다.
            blockPosition = platformPosition ? platformPosition : relativeVector;
            startPosition = this.carrierParents.get(sessionId).transform.position;
        }
        else {
            if (blockFlag == this.MOVINGBLOCK) {
                blockPosition = this.movingBlocks[blockIndex].transform.position;
            }
            else {
                blockPosition = this.orbitingBlocks[blockIndex].transform.position;
            }
            startPosition = new Vector3(blockPosition.x - relativeVector.x, blockPosition.y - relativeVector.y, blockPosition.z - relativeVector.z);
        }

        // 점프 코루틴 관련 셋팅
        this.isLanding.set(sessionId, false);

        // 캐릭터의 점프 방향 구하기 - startPositon 과 blockPosition 사이 방향 벡터를 구합니다.
        var anglePos: Vector3 = (startPosition - blockPosition);

        // 캐릭터의 점프 방향 구하기 - 플랫폼에서 블록으로 가는 경우 이미 계산된 relativeVector가 전달됩니다.
        if (blockFlag == this.FIRSTBLOCK)
            anglePos = relativeVector;

        let angle = Mathf.Atan2(anglePos.y, anglePos.x) * Mathf.Rad2Deg;
        angle = anglePos.z > 0 ? angle : angle * -1;

        // 캐릭터가 점프해서 나간 각도에 따라 고정된 점프 길이 값( playerJumpDistance : 3)만큼의 예상 점프 위치를 계산합니다.
        let targetPosition = new Vector3(startPosition.x + (Mathf.Cos(angle * Mathf.Deg2Rad) * this.playerJumpDistance),
            blockPosition.y, startPosition.z + (Mathf.Sin(angle * Mathf.Deg2Rad) * this.playerJumpDistance));

        // 점프 예측 위치는 캐릭터 마다 저장 됩니다.
        this.playerTargetPosition.set(sessionId, targetPosition);

        // 점프를 시작합니다.
        let jumpCoroutine = this.StartCoroutine(this.JumpToBlock(sessionId, startPosition, 45));
        this.jumpCoroutines.set(sessionId, jumpCoroutine);

        if (blockIndex < 0)
            return;

        if (this.carrierParents.has(sessionId)) {
            const animator = ZepetoPlayers.instance.GetPlayer(sessionId).character.ZepetoAnimator;
            animator.runtimeAnimatorController = this.moveBlockAnimator;
            animator.enabled = true;
            animator.SetBool("JumpMove", true);
        }

    }

    /**
     * JumpToBlock()
     * 캐릭터 점프에 쓰이는 포물선 함수
     * 뛰는 캐릭터와 현재 점프 시작 위치, 점프 각도를 파라미터로 가져와 SetJumpToBlockSetting에서 셋팅한 TargetPosition까지 점프를 진행합니다.
    */
    *JumpToBlock(sessionId: string, startPosition: Vector3, angle: number) {
        if (this.isLanding.get(sessionId))
            return;
        if (false == this.carrierParents.has(sessionId))
            return;

        //캐릭터가 점프 시 포물선으로 움직이게 하기 위해서 carrierParent의 Transform을 가져와 Translate함
        let characterTransform = this.carrierParents.get(sessionId).transform;
        let targetPosition = this.playerTargetPosition.get(sessionId);
        let distance = Vector3.Distance(targetPosition, startPosition);

        let velocity = distance / (Mathf.Sin(2 * angle * Mathf.Deg2Rad) / ZepetoPlayers.gravity);
        let x = Mathf.Sqrt(velocity) * Mathf.Cos(angle * Mathf.Deg2Rad);
        let y = Mathf.Sqrt(velocity) * Mathf.Sin(angle * Mathf.Deg2Rad);

        //캐릭터 점프 방향으로 캐릭터 회전값 변경
        let rot = targetPosition - startPosition;
        characterTransform.rotation = Quaternion.LookRotation(rot);
        characterTransform.rotation = new Quaternion(0, characterTransform.rotation.y, 0, characterTransform.rotation.w);

        let flightDuration = distance / x;
        let elapseTime = 0;

        while (elapseTime < flightDuration) {
            characterTransform.Translate(0, (y - (ZepetoPlayers.gravity * elapseTime)) * Time.deltaTime, x * Time.deltaTime);
            elapseTime += Time.deltaTime;
            yield null;
        }

        //블럭에서 플랫폼에 점프하는 경우에만 실행
        if (this.isLandingPlatform.has(sessionId) && this.isLandingPlatform.get(sessionId))
            this.carrierParents.get(sessionId).GetComponent<Rigidbody>().useGravity = true;

        if (this.jumpCoroutines.has(sessionId))
            this.jumpCoroutines.delete(sessionId);
    }

    public StopJumpToBlockCoroutine(sessionId: string) {
        this.isLanding.set(sessionId, true);
        if (this.jumpCoroutines.has(sessionId)) {
            this.StopCoroutine(this.jumpCoroutines.get(sessionId));
            this.jumpCoroutines.delete(sessionId);
        }
        if (this.changeTargetPositionCoroutines.has(sessionId)) {
            this.StopCoroutine(this.changeTargetPositionCoroutines.get(sessionId));
            this.changeTargetPositionCoroutines.delete(sessionId);
        }
    }
}