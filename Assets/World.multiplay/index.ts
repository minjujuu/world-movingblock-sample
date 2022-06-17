import {Sandbox, SandboxOptions, SandboxPlayer} from "ZEPETO.Multiplay";
import {DataStorage} from "ZEPETO.Multiplay.DataStorage";
import { Player, Transform, Vector3} from "ZEPETO.Multiplay.Schema";

interface PlayerBlockInfo {
    sessionId: string,
    blockIndex: number,
    relativeX:number,
    relativeY:number,
    relativeZ:number
}

interface PlayerPlatformInfo {
    sessionId: string,
    relativeX:number,
    relativeY:number,
    relativeZ:number,
    posX:number,
    posY:number,
    posZ:number
}

interface PlayerTimestamp {
    gameStartTimestamp:number,
    playerJoinTimestamp:number;
}

export default class extends Sandbox {

    MESSAGE_TYPE = {
        ServerTimestamp: "ServerTimestamp",
        OnBlockTriggerEnter: "OnBlockTriggerEnter",
        OnCharacterLandedBlock: "OnCharacterLandedBlock",
        OnCharacterJumpOnBlock: "OnCharacterJumpOnBlock",
        OnTryJump: "OnTryJump",
        OnPlatformState: "OnPlatformState",
        OnFallTriggerEnter: "OnFallTriggerEnter",
        OnTryJumpForMovingToBlock: "OnTryJumpForMovingToBlock",
        OnLeavePlayer: "OnLeavePlayer"
    }

    storageMap:Map<string,DataStorage> = new Map<string, DataStorage>();
    
    constructor() {
        super();
    }

    private gameStartTimestamp:number;
    private isFirstPlayer:boolean;

    onCreate(options: SandboxOptions) {
        this.state.elapsedTime = 0;
        this.isFirstPlayer = true;
        // Room 객체가 생성될 때 호출됩니다.
        // Room 객체의 상태나 데이터 초기화를 처리 한다.

        this.onMessage("onChangedTransform", (client, message) => {
            const player = this.state.players.get(client.sessionId);

            const transform = new Transform();
            transform.position = new Vector3();
            transform.position.x = message.position.x;
            transform.position.y = message.position.y;
            transform.position.z = message.position.z;

            transform.rotation = new Vector3();
            transform.rotation.x = message.rotation.x;
            transform.rotation.y = message.rotation.y;
            transform.rotation.z = message.rotation.z;

            player.transform = transform;
        });

        this.onMessage("onChangedState", (client, message) => {
            const player = this.state.players.get(client.sessionId);
            player.state = message.state;
            if(false == player.isOnBlock)
                return;           
            if(player.state == 4 || player.state == 5)
                player.tryJump = true;  
        });
        
        // ------------- 블록 동기화를 위한 메시지 -------------
        // - 플레이어가 무빙블록 트리거에 들어간 순간 전송되는 메시지
        this.onMessage(this.MESSAGE_TYPE.OnBlockTriggerEnter, (client, message) => {
            const player = this.state.players.get(client.sessionId);

            player.blockIndex = message;
            // 플레이어가 블록 사이를 건너는 중 (waitLanding) 이지 않을 때만 onBlockState가 false로 설정 
            player.isOnBlock = true; // 캐릭터 위치 동기화도 중지됨
        });
        
        // 플레이어가 블록에 착지한 순간 전송되는 메시지
        this.onMessage(this.MESSAGE_TYPE.OnCharacterLandedBlock, (client, message) => {
            const player = this.state.players.get(client.sessionId);
            player.blockIndex = message.blockIdx;
            let blockInfo:PlayerBlockInfo = {
                sessionId: client.sessionId,
                blockIndex: player.blockIndex,
                relativeX: message.relativePos.x,
                relativeY: message.relativePos.y,
                relativeZ: message.relativePos.z,
            };
            
            this.broadcast(this.MESSAGE_TYPE.OnCharacterLandedBlock, blockInfo, { except: client });
        });

        // 플레이어가 블록에서 나가는 순간 전송되는 메시지 
        this.onMessage(this.MESSAGE_TYPE.OnCharacterJumpOnBlock, (client, message) => {
            const player = this.state.players.get(client.sessionId);
            player.blockIndex = message.blockIdx;
            
            let blockInfo:PlayerBlockInfo = {
                sessionId: client.sessionId,
                blockIndex: player.blockIndex,
                relativeX: message.relativePos.x,
                relativeY: message.relativePos.y,
                relativeZ: message.relativePos.z,
            };

            if(player.tryJump) {           
                this.broadcast(this.MESSAGE_TYPE.OnCharacterJumpOnBlock, blockInfo, { except: client });
                player.tryJump = false; // tryJump값 초기화 
            }            
        });
    
        // 플레이어가 블록 위에서 점프를 시도했을 경우 전송되는 메시지
        this.onMessage(this.MESSAGE_TYPE.OnTryJump, (client, message) => {
            const player = this.state.players.get(client.sessionId);
            player.tryJump = message;
        });

        // 플레이어가 일반 플랫폼에 착지했을 경우 전송되는 메시지
        this.onMessage(this.MESSAGE_TYPE.OnPlatformState, (client, message) => {
            const player = this.state.players.get(client.sessionId);
            // 다른 플랫폼에 도달하면 무빙블록에서 내려온 것으로 판단 
            player.isOnBlock = false;
            // 다른 클라이언트에서 해당 캐릭터를 '운반용 부모 오브젝트'에서 해제하도록 브로드캐스트
            this.broadcast(this.MESSAGE_TYPE.OnPlatformState, client.sessionId, { except: client });
        });

        // 플레이어가 블록에서 떨어졌을 때 전송되는 메시지
        this.onMessage(this.MESSAGE_TYPE.OnFallTriggerEnter, (client, message) => {
            // 다른 클라이언트에서 해당 캐릭터를 리스폰할 수 있도록 브로드캐스트
            this.broadcast(this.MESSAGE_TYPE.OnFallTriggerEnter, client.sessionId, { except: client });
        });

        // 플레이어가 플랫폼에서 무빙블록 사이를 점프할 때 호출됨
        this.onMessage(this.MESSAGE_TYPE.OnTryJumpForMovingToBlock, (client, message) => {
            // 다른 클라이언트에서 해당 캐릭터에게 운반용 부모를 만들도록 브로드캐스트
            let platformInfo:PlayerPlatformInfo = {
                sessionId: client.sessionId,
                relativeX:message.platformPos.x,
                relativeY:message.platformPos.y,
                relativeZ:message.platformPos.z,
                posX: message.relativePos.x,
                posY: message.relativePos.y,
                posZ: message.relativePos.z
            };
            this.broadcast(this.MESSAGE_TYPE.OnTryJumpForMovingToBlock, platformInfo, { except: client });
        });
    }
    
    
    async onJoin(client: SandboxPlayer) {
        // 게임시작 시 timestamp 기록 
        // - 여기에서는 첫 번째 플레이어가 입장하는 순간이 게임시작 시간
        if(this.isFirstPlayer) {
            this.isFirstPlayer = false;
            let gameStartTimestamp = + new Date();    
            this.gameStartTimestamp = gameStartTimestamp;
        }

        // 플레이어 입장 시의 timestamp 기록
        let curTimeStamp = + new Date();
        let timeStampInfo:PlayerTimestamp = {
            gameStartTimestamp : this.gameStartTimestamp,
            playerJoinTimestamp : curTimeStamp
        };
        // timestamp를 전송
        client.send(this.MESSAGE_TYPE.ServerTimestamp, timeStampInfo);

        // schemas.json 에서 정의한 player 객체를 생성 후 초기값 설정.
        console.log(`[OnJoin] sessionId : ${client.sessionId}, HashCode : ${client.hashCode}, userId : ${client.userId}`)

        const player = new Player();
        player.tryJump = false;
        player.sessionId = client.sessionId;

        if (client.hashCode) {
            player.zepetoHash = client.hashCode;
        }
        if (client.userId) {
            player.zepetoUserId = client.userId;
        }
        player.isOnBlock = false;
        
        // client 객체의 고유 키값인 sessionId 를 사용해서 Player 객체를 관리.
        // set 으로 추가된 player 객체에 대한 정보를 클라이언트에서는 players 객체에 add_OnAdd 이벤트를 추가하여 확인 할 수 있음.
        this.state.players.set(client.sessionId, player);
    }

    private elapsedTime: number = 0;

    onTick(deltaTime: number): void {   

        // 서버 onCreate시간 체크한 경우에만 같이 누적 시작하도록
        if(false == this.isFirstPlayer) {
            this.elapsedTime += deltaTime;
            this.state.elapsedTime = this.elapsedTime/1000;
        }
    }

    onLeave(client: SandboxPlayer, consented?: boolean) {
        this.broadcast(this.MESSAGE_TYPE.OnLeavePlayer, client.sessionId);
        console.log(`[onLeave] sessionId = ${client.sessionId}`);
        // allowReconnection 설정을 통해 순단에 대한 connection 유지 처리등을 할 수 있으나 기본 가이드에서는 즉시 정리.
        // delete 된 player 객체에 대한 정보를 클라이언트에서는 players 객체에 add_OnRemove 이벤트를 추가하여 확인 할 수 있음.
        this.state.players.delete(client.sessionId);
        
    }
}