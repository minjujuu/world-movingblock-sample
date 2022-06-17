import { CharacterController, Collider, Time, Vector3, Transform } from 'UnityEngine';
import { ZepetoScriptBehaviour } from 'ZEPETO.Script'
import { ZepetoCharacter, ZepetoPlayers } from 'ZEPETO.Character.Controller'

export default class OrbitingBlock extends ZepetoScriptBehaviour {

    // 블록 회전 관련 변수
    @Header("Orbit Block")
    public rotSpeed: number = 0;
    public rotatingPoint: Transform;
    public characterSpeedControlValue: number = 6;

    private localCharacter: ZepetoCharacter;
    private localCharacterController: CharacterController;

    private isLocalPlayerOnBlock: boolean = false;
    private rotateAroundAxis: Vector3;

    private prevBlockPosition: Vector3 = Vector3.zero;

    private Start() {

        ZepetoPlayers.instance.OnAddedLocalPlayer.AddListener(() => {
            this.localCharacter = ZepetoPlayers.instance.LocalPlayer.zepetoPlayer.character;
            this.localCharacterController = this.localCharacter.GetComponent<CharacterController>();
        });

        this.isLocalPlayerOnBlock = false;
        this.rotateAroundAxis = Vector3.down;
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
        }
    }

    private OnTriggerExit(coll: Collider) {
        if (coll.gameObject != this.localCharacter.gameObject) {
            return;
        }
        this.isLocalPlayerOnBlock = false;
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
    }

}