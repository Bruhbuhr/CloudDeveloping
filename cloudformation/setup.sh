AWS_PROFILE=renovalab

PREFIX=asm
ENVIRONMENT=test

aws ec2 describe-images \
    --region ap-southeast-1 \
    --owners 099720109477 \
    --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-*-22.04-amd64-server-*" "Name=state,Values=available" \
    --query "Images | sort_by(@, &CreationDate)[-1].ImageId" \
    --output text \
    --profile renovalab

aws ec2 describe-images \
    --region us-east-1 \
    --owners 099720109477 \
    --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-*-22.04-amd64-server-*" "Name=state,Values=available" \
    --query "Images | sort_by(@, &CreationDate)[-1].ImageId" \
    --output text \
    --profile renovalab

aws cloudformation create-stack \
    --stack-name asm-test-compute-stack \
    --template-body file://compute-resources.yaml \
    --parameters ParameterKey=Prefix,ParameterValue=asm3 ParameterKey=Env,ParameterValue=test ParameterKey=KeyPair,ParameterValue=khang-key ParameterKey=InstanceProfile,ParameterValue="LabInstanceProfile"\
    --profile=renovalab

aws cloudformation update-stack \
    --stack-name asm-test-compute-stack \
    --template-body file://compute-resources.yaml \
    --parameters ParameterKey=Prefix,ParameterValue=asm3 ParameterKey=Env,ParameterValue=test ParameterKey=KeyPair,ParameterValue=khang-key ParameterKey=InstanceProfile,ParameterValue="LabInstanceProfile"\
    --profile=renovalab

aws cloudformation create-stack \
    --stack-name asm-serverless-test-stack \
    --template-body file://serverless-resources.yaml \
    --parameters ParameterKey=Prefix,ParameterValue=asm3 ParameterKey=Env,ParameterValue=test \
    --profile=renovalab

aws cloudformation create-stack \
    --stack-name asm-role-stack \
    --template-body file://role.yaml \
    --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
    --profile=renovalab

aws cloudformation update-stack \
    --stack-name asm-serverless-test-stack \
    --template-body file://serverless-resources.yaml \
    --parameters ParameterKey=Prefix,ParameterValue=asm3 ParameterKey=Env,ParameterValue=test \
    --profile=renovalab

aws cloudformation delete-stack \
    --stack-name asm-test-compute-stack \
    --profile=renovalab

aws cloudformation delete-stack \
    --stack-name asm-serverless-test-stack \
    --profile=renovalab

aws cloudformation create-stack \
    --stack-name asm-lab-role \
    --template-body file://labrole.yaml \
    --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
    --profile=renovalab

curl -X POST \
  -H "x-api-key: Aup0QvmoOE76igFBMLBjT5z0cCng6LUD8J7491ai" \
  -H "Content-Type: application/json" \
  "https://bno1ftpla5.execute-api.ap-southeast-1.amazonaws.com/test/subscribe?email=kiaitosantori@gmail.com"
