import {Component,type ReactNode} from "react";

type AdminErrorBoundaryState={failed:boolean};

export class AdminErrorBoundary extends Component<{children:ReactNode},AdminErrorBoundaryState>{
  state:AdminErrorBoundaryState={failed:false};
  static getDerivedStateFromError():AdminErrorBoundaryState{return {failed:true}}
  private retry=()=>this.setState({failed:false});
  render(){
    if(this.state.failed)return <main className="admin-fatal-error" role="alert"><span aria-hidden="true">!</span><h1>No se pudo mostrar este módulo</h1><p>La consola protegió la sesión. Puedes volver a intentar sin repetir una operación administrativa.</p><button onClick={this.retry} type="button">Reintentar módulo</button></main>;
    return this.props.children;
  }
}
