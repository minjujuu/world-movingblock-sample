import { CharacterController, Collider, Mathf, Quaternion, Rigidbody, Time, Vector3, } from 'UnityEngine';
import { ZepetoScriptBehaviour } from 'ZEPETO.Script'
import { ZepetoCharacter, ZepetoPlayers } from 'ZEPETO.Character.Controller'

export default class MovingBlock extends ZepetoScriptBehaviour {

    @Header("Move Block")
    public rigidbody: Rigidbody;
    public moveSpeed: Vector3;
    public timeToMove: number = 1;

    private moveDirection: int;

    private isLocalPlayerOnBlock: boolean = false;
    private localCharacter: ZepetoCharacter;
    private localCharacterController: CharacterController;

    @Header("Rotate Block (Option)")
    public isBlockRotating: boolean;
    public eulerAngleVelocity: Vector3;

    public characterRotateAroundSpeed: number = -1;

    private prevDirection: number = 0;
    private clientElapsedTime: number = 0;

    private Start() {

        this.moveDirection = 1;
        this.prevDirection = -1;

        this.rigidbody.useGravity = false;
        this.rigidbody.isKinematic = false;
        this.rigidbody.freezeRotation = true;
        this.rigidbody.velocity = this.moveSpeed * this.moveDirection;

        ZepetoPlayers.instance.OnAddedLocalPlayer.AddListener(() => {
            this.localCharacter = ZepetoPlayers.instance.LocalPlayer.zepetoPlayer.character;
            this.localCharacterController = this.localCharacter.GetComponent<CharacterController>();
        });

        this.isLocalPlayerOnBlock = false;
    }

    private FixedUpdate() {
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
        if (coll.gameObject != this.localCharacter.gameObject) {
            return;
        }
        this.isLocalPlayerOnBlock = true;
    }

    private OnTriggerExit(coll: Collider) {
        if (coll.gameObject != this.localCharacter.gameObject) {
            return;
        }
        this.isLocalPlayerOnBlock = false;
    }

    /* MoveBlock() 
       - 현재 블록의 방향 및 속도를 지정합니다.
    */
    private MoveBlock(elapsedTime: number) {

        let predictedDir: number = (Mathf.Floor(elapsedTime / this.timeToMove)) % 2 == 0 ? 1 : -1;

        // 방향은 예측 방향으로 계속 설정
        this.moveDirection = predictedDir;

        // 이전 방향과 다른 경우에만 velocity 재설정
        if (this.moveDirection != this.prevDirection) {
            // 블록 이동 속도 재설정
            this.rigidbody.velocity = this.moveSpeed * this.moveDirection;
        }

        this.prevDirection = this.moveDirection;
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
    }
}